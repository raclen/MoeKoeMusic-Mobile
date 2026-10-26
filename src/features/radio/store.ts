import { useSyncExternalStore } from 'react';

import { isCurrentQueueGeneration, playerActions, usePlayer } from '@/features/player/store';
import type { PlayerTrack } from '@/features/player/types';

import { dislikePersonalFmSong, fetchPersonalFmSongs } from './radio-api';
import {
  PERSONAL_FM_MODES,
  type PersonalFmMode,
  type PersonalFmSongPoolId,
} from './types';

export interface RadioState {
  mode: PersonalFmMode;
  songPoolId: PersonalFmSongPoolId;
  previewSongs: PlayerTrack[];
  loading: boolean;
  error: string;
}

const INITIAL_RADIO_STATE: RadioState = {
  mode: 'normal',
  songPoolId: 0,
  previewSongs: [],
  loading: false,
  error: '',
};

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState(partial: Partial<T>) {
      let changed = false;
      for (const key of Object.keys(partial) as (keyof T)[]) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      state = { ...state, ...partial };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const radioStore = createStore(INITIAL_RADIO_STATE);

let activeRadioGeneration = 0;
let isFetchingNextBatch = false;

async function fetchSongsForMode(
  mode: PersonalFmMode,
  songPoolId: PersonalFmSongPoolId,
  currentTrack?: PlayerTrack | null
): Promise<PlayerTrack[]> {
  return fetchPersonalFmSongs({
    mode,
    songPoolId,
    action: 'play',
    currentTrack,
    remainSongCount: 0,
  });
}

export const radioActions = {
  async loadPreview(force = false): Promise<void> {
    const { previewSongs, loading, mode, songPoolId } = radioStore.getState();
    if (loading || (previewSongs.length > 0 && !force)) {
      return;
    }

    radioStore.setState({ loading: true, error: '' });
    try {
      const songs = await fetchSongsForMode(mode, songPoolId);
      radioStore.setState({
        previewSongs: songs,
        loading: false,
        error: songs.length ? '' : '暂无推荐歌曲',
      });
    } catch (error) {
      radioStore.setState({
        loading: false,
        error: error instanceof Error ? error.message : '电台加载失败',
      });
    }
  },

  async cycleMode(isRadioPlaying: boolean): Promise<PersonalFmMode> {
    const { mode, songPoolId } = radioStore.getState();
    const modes: PersonalFmMode[] = ['normal', 'small', 'peak'];
    const nextMode = modes[(modes.indexOf(mode) + 1) % modes.length];

    radioStore.setState({ mode: nextMode, loading: true, error: '' });

    try {
      const songs = await fetchSongsForMode(nextMode, songPoolId);
      radioStore.setState({
        previewSongs: songs,
        loading: false,
        error: songs.length ? '' : '暂无推荐歌曲',
      });

      if (isRadioPlaying && songs.length > 0) {
        const gen = await playerActions.playTracks(songs, 0);
        activeRadioGeneration = gen ?? 0;
      }
    } catch (error) {
      radioStore.setState({
        loading: false,
        error: error instanceof Error ? error.message : '模式切换失败',
      });
    }

    return nextMode;
  },

  async toggleSongPool(isRadioPlaying: boolean): Promise<PersonalFmSongPoolId> {
    const { mode, songPoolId } = radioStore.getState();
    const nextPool: PersonalFmSongPoolId = songPoolId === 0 ? 1 : 0;

    radioStore.setState({ songPoolId: nextPool, loading: true, error: '' });

    try {
      const songs = await fetchSongsForMode(mode, nextPool);
      radioStore.setState({
        previewSongs: songs,
        loading: false,
        error: songs.length ? '' : '暂无推荐歌曲',
      });

      if (isRadioPlaying && songs.length > 0) {
        const gen = await playerActions.playTracks(songs, 0);
        activeRadioGeneration = gen ?? 0;
      }
    } catch (error) {
      radioStore.setState({
        loading: false,
        error: error instanceof Error ? error.message : '切换失败',
      });
    }

    return nextPool;
  },

  async playRadio(): Promise<void> {
    const { previewSongs, mode, songPoolId } = radioStore.getState();

    let tracks = previewSongs;
    if (!tracks.length) {
      radioStore.setState({ loading: true, error: '' });
      try {
        tracks = await fetchSongsForMode(mode, songPoolId);
        radioStore.setState({ previewSongs: tracks, loading: false });
      } catch (err) {
        radioStore.setState({
          loading: false,
          error: err instanceof Error ? err.message : '电台加载失败',
        });
        return;
      }
    }

    if (tracks.length > 0) {
      const gen = await playerActions.playTracks(tracks, 0);
      activeRadioGeneration = gen ?? 0;
    }
  },

  async dislikeCurrent(currentTrack: PlayerTrack): Promise<void> {
    const { mode, songPoolId } = radioStore.getState();

    try {
      const newSongs = await dislikePersonalFmSong(currentTrack, mode, songPoolId);
      if (newSongs.length > 0 && activeRadioGeneration > 0) {
        playerActions.appendTracks(newSongs, activeRadioGeneration);
      }
    } catch (error) {
      console.warn('[PersonalFM] 不喜欢上报失败:', error);
    }

    playerActions.next();
  },

  async checkAndReplenish(currentIndex: number, totalQueue: number): Promise<void> {
    if (isFetchingNextBatch || activeRadioGeneration === 0) {
      return;
    }

    // 剩余未播歌曲 <= 2 首时自动在后台拉取下一批补齐
    if (totalQueue - currentIndex <= 2) {
      isFetchingNextBatch = true;
      const { mode, songPoolId } = radioStore.getState();
      try {
        const moreSongs = await fetchSongsForMode(mode, songPoolId);
        if (moreSongs.length > 0 && isCurrentQueueGeneration(activeRadioGeneration)) {
          playerActions.appendTracks(moreSongs, activeRadioGeneration);
        }
      } catch (error) {
        console.warn('[PersonalFM] 补齐拉取失败:', error);
      } finally {
        isFetchingNextBatch = false;
      }
    }
  },
};

export function useRadioState(): RadioState {
  return useSyncExternalStore(
    radioStore.subscribe,
    () => radioStore.getState(),
    () => INITIAL_RADIO_STATE
  );
}

/**
 * 判断当前播放器正在播放的歌曲是否属于红心电台
 */
export function useIsRadioActive(): {
  isRadioActive: boolean;
  isRadioPlaying: boolean;
  currentRadioTrack: PlayerTrack | null;
} {
  const { track, playing } = usePlayer();
  const isRadioActive = track?.source === 'radio';
  return {
    isRadioActive,
    isRadioPlaying: isRadioActive && playing,
    currentRadioTrack: isRadioActive ? track : null,
  };
}

export function getRadioModeConfig(mode: PersonalFmMode) {
  return PERSONAL_FM_MODES[mode];
}
