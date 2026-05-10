import React, { useRef } from 'react';
import { Animated, Pressable, Platform, StyleSheet } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * AnimatedButton - A cross-platform interactive button component.
 * Features:
 * - Spring-based scale down on press (Mobile & Web)
 * - Opacity feedback
 * - Scale up on hover (Web only)
 */
export default function AnimatedButton({ 
  onPress, 
  onLongPress,
  style, 
  disabled, 
  children,
  activeScale = 0.95,
  hoverScale = 1.02,
  activeOpacity = 0.7,
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const animate = (scaleValue, opacityValue) => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: scaleValue,
        useNativeDriver: true,
        speed: 50,
        bounciness: 4,
      }),
      Animated.timing(opacityAnim, {
        toValue: opacityValue,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressIn = () => {
    if (!disabled) animate(activeScale, activeOpacity);
  };

  const handlePressOut = () => {
    if (!disabled) animate(1, 1);
  };

  const handleHoverIn = () => {
    if (!disabled && Platform.OS === 'web') animate(hoverScale, 1);
  };

  const handleHoverOut = () => {
    if (!disabled && Platform.OS === 'web') animate(1, 1);
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      disabled={disabled}
      style={[
        style,
        { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        disabled && styles.disabled,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.5,
  },
});
