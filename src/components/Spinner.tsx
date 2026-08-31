/**
 * @deprecated Use LoadingIndicator instead.
 *
 * Thin compatibility shim — re-exports LoadingIndicator with the old Spinner
 * prop surface so any missed call site still compiles.  Remove once all
 * imports have been updated to LoadingIndicator.
 */
import React, { memo } from 'react';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  size?: number;
  color: string;
  spinning?: boolean;
  testID?: string;
}

function SpinnerView({ size = 16, color, spinning = true, testID }: Props) {
  return (
    <LoadingIndicator
      size={size}
      color={color}
      containerColor="transparent"
      spinning={spinning}
      testID={testID}
    />
  );
}

export const Spinner = memo(SpinnerView);
