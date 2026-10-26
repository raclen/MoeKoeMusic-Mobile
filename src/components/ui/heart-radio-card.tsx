import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Text, View, XStack, YStack } from 'tamagui';

import { showToast } from '@/components/ui/toast';
import { playerActions, usePlayer } from '@/features/player/store';
import {
  getRadioModeConfig,
  radioActions,
  useIsRadioActive,
  useRadioState,
} from '@/features/radio/store';
import { PERSONAL_FM_POOLS } from '@/features/radio/types';
import { useIsDark } from '@/hooks/use-palette';

type HeartRadioCardProps = {
  cardWidth: number;
  cardHeight?: number;
};

export function HeartRadioCard({ cardWidth, cardHeight = 150 }: HeartRadioCardProps) {
  const isDark = useIsDark();
  const radio = useRadioState();
  const { isRadioActive, isRadioPlaying, currentRadioTrack } = useIsRadioActive();
  const player = usePlayer();
  const rotation = useSharedValue(0);
  const [switching, setSwitching] = useState(false);

  // 初次挂载时若无预览曲目则拉取
  useEffect(() => {
    void radioActions.loadPreview(false);
  }, []);

  // 播放到剩余 2 首以内时自动后台补齐新推荐
  useEffect(() => {
    if (isRadioActive && player.queue.length > 0) {
      void radioActions.checkAndReplenish(player.index, player.queue.length);
    }
  }, [isRadioActive, player.index, player.queue.length]);

  // 黑胶唱片旋转动画
  useEffect(() => {
    if (isRadioPlaying) {
      rotation.value = withRepeat(
        withTiming(rotation.value + 360, { duration: 16000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      cancelAnimation(rotation);
    }
  }, [isRadioPlaying, rotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  const modeConfig = getRadioModeConfig(radio.mode);
  const poolConfig = PERSONAL_FM_POOLS[radio.songPoolId];

  // 当前卡片展示的曲目优先取正在播放的电台歌，其次取预取的第 1 首歌
  const activeTrack = isRadioActive ? currentRadioTrack : radio.previewSongs[0] ?? null;

  async function handleTogglePlay() {
    if (radio.loading) {
      return;
    }

    if (isRadioActive) {
      playerActions.toggle();
    } else {
      await radioActions.playRadio();
    }
  }

  async function handleCycleMode() {
    if (radio.loading || switching) return;
    setSwitching(true);
    try {
      const nextMode = await radioActions.cycleMode(isRadioPlaying);
      const nextConf = getRadioModeConfig(nextMode);
      showToast(`已切换至「${nextConf.title}」`);
    } finally {
      setSwitching(false);
    }
  }

  async function handleTogglePool() {
    if (radio.loading || switching) return;
    setSwitching(true);
    try {
      const nextPool = await radioActions.toggleSongPool(isRadioPlaying);
      showToast(`已切换推荐策略：${PERSONAL_FM_POOLS[nextPool].label}`);
    } finally {
      setSwitching(false);
    }
  }

  async function handleDislike() {
    if (!currentRadioTrack) {
      showToast('当前没有正在播放的电台歌曲');
      return;
    }
    await radioActions.dislikeCurrent(currentRadioTrack);
    showToast('已移入垃圾桶，将减少此类推荐');
  }

  async function handleRefresh() {
    if (radio.loading) return;
    await radioActions.loadPreview(true);
    showToast('已刷新电台推荐');
  }

  // 现代红心电台流光渐变底色
  const gradientColors: [string, string, string] = isDark
    ? ['#B8143C', '#7F0D29', '#3D0613']
    : ['#FF3366', '#E6154A', '#990B30'];

  return (
    <View
      width={cardWidth}
      height={cardHeight}
      borderRadius={22}
      overflow="hidden"
      style={styles.cardShadow}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}>
        {/* 背景轻微光晕装饰圈 */}
        <View
          position="absolute"
          right={-20}
          top={-20}
          width={180}
          height={180}
          borderRadius={90}
          backgroundColor="rgba(255, 255, 255, 0.08)"
          pointerEvents="none"
        />
        <View
          position="absolute"
          right={40}
          bottom={-30}
          width={120}
          height={120}
          borderRadius={60}
          backgroundColor="rgba(255, 255, 255, 0.05)"
          pointerEvents="none"
        />

        <YStack flex={1} paddingHorizontal={16} paddingVertical={12} justifyContent="space-between">
          {/* 顶部栏：模式 Badge、策略切换、不喜欢与刷新按钮 */}
          <XStack alignItems="center" justifyContent="space-between">
            <XStack alignItems="center" gap={7}>
              {/* 模式切换胶囊 */}
              <XStack
                alignItems="center"
                gap={5}
                paddingHorizontal={10}
                paddingVertical={4}
                borderRadius={999}
                backgroundColor="rgba(255, 255, 255, 0.22)"
                borderWidth={StyleSheet.hairlineWidth}
                borderColor="rgba(255, 255, 255, 0.35)"
                pressStyle={{ opacity: 0.8, scale: 0.96 }}
                onPress={() => void handleCycleMode()}>
                <Ionicons name="heart" size={13} color="#FFFFFF" />
                <Text color="#FFFFFF" fontSize={12} fontWeight="700">
                  {modeConfig.title}
                </Text>
                <Ionicons name="swap-horizontal" size={12} color="rgba(255, 255, 255, 0.8)" />
              </XStack>

              {/* 推荐策略池切换胶囊 */}
              <XStack
                alignItems="center"
                paddingHorizontal={8}
                paddingVertical={4}
                borderRadius={999}
                backgroundColor="rgba(0, 0, 0, 0.18)"
                pressStyle={{ opacity: 0.8, scale: 0.96 }}
                onPress={() => void handleTogglePool()}>
                <Text color="rgba(255, 255, 255, 0.85)" fontSize={11} fontWeight="600">
                  {poolConfig.shortLabel}
                </Text>
              </XStack>
            </XStack>

            {/* 右上角操作项 */}
            <XStack alignItems="center" gap={8}>
              {/* 不喜欢 / 垃圾桶（仅在正在播放电台歌曲时可用） */}
              {isRadioActive && currentRadioTrack ? (
                <XStack
                  width={28}
                  height={28}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="rgba(255, 255, 255, 0.18)"
                  pressStyle={{ opacity: 0.7, scale: 0.92 }}
                  onPress={() => void handleDislike()}>
                  <Ionicons name="trash-outline" size={14} color="#FFFFFF" />
                </XStack>
              ) : null}

              {/* 刷新推荐 */}
              <XStack
                width={28}
                height={28}
                borderRadius={14}
                alignItems="center"
                justifyContent="center"
                backgroundColor="rgba(255, 255, 255, 0.18)"
                pressStyle={{ opacity: 0.7, scale: 0.92 }}
                onPress={() => void handleRefresh()}>
                {radio.loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ transform: [{ scale: 0.7 }] }} />
                ) : (
                  <Ionicons name="reload-outline" size={14} color="#FFFFFF" />
                )}
              </XStack>
            </XStack>
          </XStack>

          {/* 中间主要信息区 */}
          <XStack alignItems="center" justifyContent="space-between" gap={12}>
            {/* 左侧文字区 */}
            <YStack flex={1} gap={3} justifyContent="center">
              <XStack alignItems="center" gap={5}>
                {isRadioPlaying ? (
                  <XStack alignItems="center" gap={2}>
                    <View width={2.5} height={10} backgroundColor="#FFFFFF" borderRadius={2} />
                    <View width={2.5} height={14} backgroundColor="#FFFFFF" borderRadius={2} />
                    <View width={2.5} height={8} backgroundColor="#FFFFFF" borderRadius={2} />
                  </XStack>
                ) : (
                  <Ionicons name="radio" size={12} color="rgba(255, 255, 255, 0.8)" />
                )}
                <Text color="rgba(255, 255, 255, 0.85)" fontSize={11} fontWeight="600" numberOfLines={1}>
                  {isRadioPlaying
                    ? '正在播放 · 点击暂停'
                    : isRadioActive
                      ? '电台已暂停 · 点击继续'
                      : modeConfig.subtitle}
                </Text>
              </XStack>

              <Text
                color="#FFFFFF"
                fontSize={17}
                fontWeight="800"
                numberOfLines={1}
                ellipsizeMode="tail">
                {activeTrack ? activeTrack.title : '开启私人红心漫游'}
              </Text>

              <Text
                color="rgba(255, 255, 255, 0.82)"
                fontSize={12.5}
                fontWeight="500"
                numberOfLines={1}
                ellipsizeMode="tail">
                {activeTrack ? activeTrack.artist : `${poolConfig.label} · 发现心动旋律`}
              </Text>
            </YStack>

            {/* 右侧黑胶唱片与播放控制按钮 */}
            <XStack alignItems="center" position="relative">
              {/* 黑胶光盘 */}
              <View
                width={80}
                height={80}
                borderRadius={40}
                backgroundColor="#12131F"
                borderWidth={2}
                borderColor="rgba(255, 255, 255, 0.3)"
                overflow="hidden"
                alignItems="center"
                justifyContent="center"
                style={styles.discShadow}>
                <Animated.View style={[{ width: 76, height: 76, borderRadius: 38 }, spinStyle]}>
                  {activeTrack?.coverUrl ? (
                    <Image
                      source={{ uri: activeTrack.coverUrl }}
                      style={{ width: 76, height: 76, borderRadius: 38 }}
                      contentFit="cover"
                      transition={250}
                    />
                  ) : (
                    <View
                      flex={1}
                      borderRadius={38}
                      backgroundColor="rgba(255, 255, 255, 0.12)"
                      alignItems="center"
                      justifyContent="center">
                      <Ionicons name="musical-notes" size={28} color="rgba(255, 255, 255, 0.7)" />
                    </View>
                  )}
                  {/* 黑胶中心黑孔 */}
                  <View
                    position="absolute"
                    alignSelf="center"
                    top={28}
                    width={20}
                    height={20}
                    borderRadius={10}
                    backgroundColor="#0E0F16"
                    borderWidth={3}
                    borderColor="rgba(255, 255, 255, 0.4)"
                  />
                </Animated.View>
              </View>

              {/* 悬浮 Play / Pause 按钮 */}
              <XStack
                position="absolute"
                right={-4}
                bottom={-4}
                width={36}
                height={36}
                borderRadius={18}
                backgroundColor="#FFFFFF"
                alignItems="center"
                justifyContent="center"
                style={styles.playFabShadow}
                pressStyle={{ scale: 0.9, opacity: 0.9 }}
                onPress={() => void handleTogglePlay()}>
                {radio.loading ? (
                  <ActivityIndicator size="small" color="#E6154A" style={{ transform: [{ scale: 0.8 }] }} />
                ) : (
                  <Ionicons
                    name={isRadioPlaying ? 'pause' : 'play'}
                    size={18}
                    color="#E6154A"
                    style={!isRadioPlaying ? { marginLeft: 2 } : undefined}
                  />
                )}
              </XStack>
            </XStack>
          </XStack>
        </YStack>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: '#E6154A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  discShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  playFabShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 5,
  },
});
