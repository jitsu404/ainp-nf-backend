import { afterEach, describe, expect, it, vi } from 'vitest';

/** Loads devLog against a fake env so each NODE_ENV can be tested. */
const loadDevLog = async (nodeEnv: 'development' | 'production' | 'test') => {
  vi.resetModules();
  vi.doMock('../src/config/env.js', () => ({ env: { NODE_ENV: nodeEnv } }));
  return (await import('../src/utils/devLog.js')).devLog;
};

describe('devLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config/env.js');
  });

  it('prints in development', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (await loadDevLog('development'))('hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('is silent in production and test by default', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (await loadDevLog('production'))('hidden');
    (await loadDevLog('test'))('hidden');
    expect(spy).not.toHaveBeenCalled();
  });

  it('prints in production when force is true', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const devLog = await loadDevLog('production');
    devLog('banner', true);
    devLog.error('boom', true);
    expect(log).toHaveBeenCalledWith('banner');
    expect(error).toHaveBeenCalledWith('boom');
  });
});
