jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from '../src/lib/supabase';
import {
  clearCallQualitySamples,
  flushCallQualitySamples,
  queueCallQualitySample,
} from '../src/api/callMedia/quality';

const CALL_ID = 'ca110000-0000-4000-8000-000000000001';
const mockRpc = supabase.rpc as jest.Mock;

describe('call quality batching', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    clearCallQualitySamples(CALL_ID);
  });

  it('never exceeds the ten-sample RPC contract after a transient failure', async () => {
    let finishFirst!: (value: { error: { message: string } }) => void;
    mockRpc.mockReturnValueOnce(
      new Promise(resolve => {
        finishFirst = resolve;
      }),
    );

    for (let index = 0; index < 30; index += 1) {
      queueCallQualitySample(CALL_ID, {
        backend: 'current',
        capturedAtMs: index,
      });
    }
    const firstFlush = flushCallQualitySamples(CALL_ID);
    finishFirst({ error: { message: 'temporary' } });
    await firstFlush;

    mockRpc.mockResolvedValue({ error: null });
    await flushCallQualitySamples(CALL_ID);

    expect(mockRpc).toHaveBeenCalledTimes(4);
    for (const [, args] of mockRpc.mock.calls) {
      expect(args.p_samples).toHaveLength(10);
    }
  });
});
