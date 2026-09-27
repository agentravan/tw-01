import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../memory/store.js';
import { ControlRoom } from '../control-room/runtime.js';

const makeRuntime = () => new ControlRoom(new JsonStore(join(mkdtempSync(join(tmpdir(), 'tw01-control-room-')), 'state.json')));

describe('Control Room employee execution status', () => {
  it('shows an assigned task as waiting, then working only after a run starts', async () => {
    const runtime = makeRuntime();
    await runtime.ensureSeed();
    const task = await runtime.createTask({ goal: 'Prepare the daily operations report', assignedBy: 'founder', assignedTo: 'ai-boss' });
    let snapshot = await runtime.snapshot();
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.status).toBe('WAITING');
    expect(snapshot.tasks.find(t => t.id === task.id)?.status).toBe('ASSIGNED');
    expect(snapshot.runs).toHaveLength(0);

    const run = await runtime.startRun('ai-boss', task.id, 'manual');
    snapshot = await runtime.snapshot();
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.status).toBe('WORKING');
    expect(snapshot.tasks.find(t => t.id === task.id)?.status).toBe('WORKING');
    expect(snapshot.runs.find(r => r.id === run.id)?.status).toBe('RUNNING');

    await runtime.finish(run.id, { summary: 'Done' });
    snapshot = await runtime.snapshot();
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.status).toBe('COMPLETED');
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.currentTaskId).toBeNull();
    expect(snapshot.tasks.find(t => t.id === task.id)?.status).toBe('COMPLETED');
  });

  it('marks an expired run STALLED and blocks its task instead of claiming work is active', async () => {
    const runtime = makeRuntime();
    await runtime.ensureSeed();
    const task = await runtime.createTask({ goal: 'Review the order queue', assignedBy: 'founder', assignedTo: 'ai-boss' });
    const run = await runtime.startRun('ai-boss', task.id, 'manual');
    const expired = new Date(Date.now() - 5 * 60_000).toISOString();
    const store = (runtime as any).store as JsonStore;
    await store.update(s => {
      s.runs.find(r => r.id === run.id)!.heartbeatAt = expired;
      s.employees.find(e => e.id === 'ai-boss')!.lastHeartbeat = expired;
    });

    const snapshot = await runtime.snapshot();
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.status).toBe('STALLED');
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.health).toBe('STALE');
    expect(snapshot.tasks.find(t => t.id === task.id)?.status).toBe('BLOCKED');
    expect(snapshot.runs.find(r => r.id === run.id)?.status).toBe('STALLED');
    expect(snapshot.events.some(e => e.runId === run.id && e.type === 'ERROR')).toBe(true);
  });

  it('ignores heartbeats and completion callbacks for non-running runs', async () => {
    const runtime = makeRuntime();
    await runtime.ensureSeed();
    const task = await runtime.createTask({ goal: 'Check stale callback handling', assignedBy: 'founder', assignedTo: 'ai-boss' });
    const run = await runtime.startRun('ai-boss', task.id, 'manual');
    await runtime.finish(run.id, { ok: true });
    await runtime.heartbeat(run.id, 'late heartbeat', 25);
    await runtime.finish(run.id, { overwritten: true });

    const snapshot = await runtime.snapshot();
    expect(snapshot.employees.find(e => e.id === 'ai-boss')?.status).toBe('COMPLETED');
    expect(snapshot.tasks.find(t => t.id === task.id)?.result).toEqual({ ok: true });
    expect(snapshot.runs.find(r => r.id === run.id)?.status).toBe('COMPLETED');
    expect(snapshot.events.filter(e => e.runId === run.id && e.type === 'HEARTBEAT')).toHaveLength(0);
  });
});
