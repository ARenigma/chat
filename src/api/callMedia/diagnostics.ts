import { useEffect } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { setCallDiagnostics } from './quality';
import type { CallQualitySample } from './types';

interface NativeDiagnostics {
  start(): void;
  stop(): void;
  snapshot(): Promise<{
    networkTransport?: string;
    rssBytes?: number;
    thermalStatus?: number;
  }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const native = (
  NativeModules as { CallDiagnostics?: NativeDiagnostics }
).CallDiagnostics;

/** Starts Android's NetworkCallback and process snapshot only during a call. */
export function useCallDiagnostics(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android' || !native) return;
    const emitter = new NativeEventEmitter(native);
    const subscription = emitter.addListener(
      'callNetworkChanged',
      (networkTransport: string) => setCallDiagnostics({ networkTransport }),
    );
    const capture = () => {
      void native.snapshot().then(value => {
        setCallDiagnostics(value as Partial<CallQualitySample>);
      });
    };
    native.start();
    capture();
    const timer = setInterval(capture, 2000);
    return () => {
      clearInterval(timer);
      subscription.remove();
      native.stop();
      setCallDiagnostics({});
    };
  }, [enabled]);
}
