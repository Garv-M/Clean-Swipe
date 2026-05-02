import { Colors } from '@/constants/theme';
import RNBottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetProps,
} from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback } from 'react';

interface AppBottomSheetProps {
  snapPoints: BottomSheetProps['snapPoints'];
  children: React.ReactNode;
}

const BottomSheet = forwardRef<RNBottomSheet, AppBottomSheetProps>(
  ({ snapPoints, children }, ref) => {
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      [],
    );

    return (
      <RNBottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={handleIndicatorStyle}
        backgroundStyle={backgroundStyle}>
        {children}
      </RNBottomSheet>
    );
  },
);

BottomSheet.displayName = 'BottomSheet';

export default BottomSheet;

const handleIndicatorStyle = { backgroundColor: 'rgba(255,255,255,0.3)' };
const backgroundStyle = { backgroundColor: Colors.cardFrom };
