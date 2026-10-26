export type PersonalFmMode = 'normal' | 'small' | 'peak';

export type PersonalFmSongPoolId = 0 | 1;

export interface PersonalFmModeInfo {
  mode: PersonalFmMode;
  title: string;
  shortLabel: string;
  subtitle: string;
}

export const PERSONAL_FM_MODES: Record<PersonalFmMode, PersonalFmModeInfo> = {
  normal: {
    mode: 'normal',
    title: '红心 Radio',
    shortLabel: '红心',
    subtitle: '根据你的口味持续刷新',
  },
  small: {
    mode: 'small',
    title: '小众 Radio',
    shortLabel: '小众',
    subtitle: '给你一点不那么主流的惊喜',
  },
  peak: {
    mode: 'peak',
    title: '速览 Radio',
    shortLabel: '速览',
    subtitle: '切到更带劲的高能推荐频道',
  },
};

export const PERSONAL_FM_POOLS: Record<PersonalFmSongPoolId, { label: string; shortLabel: string }> = {
  0: { label: '根据口味', shortLabel: '口味' },
  1: { label: '根据风格', shortLabel: '风格' },
};
