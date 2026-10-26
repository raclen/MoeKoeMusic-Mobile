import type { PlayerTrack } from '@/features/player/types';
import {
  detectAudioQuality,
  pickNumber,
  pickStringLike,
  pickText,
  toRecord,
  toRecords,
} from '@/lib/api-parse';
import { sizedImage, splitArtistTitle } from '@/lib/format';
import { bootstrapMobileApi, mobileApi } from '@/lib/kugou-api';
import { getSessionSnapshot } from '@/lib/kugou-api/session';

import type { PersonalFmMode, PersonalFmSongPoolId } from './types';

export function normalizeRadioSong(raw: Record<string, unknown>): PlayerTrack | null {
  const relateGoods = toRecords(raw.relate_goods);
  const primaryRelate = relateGoods[0] ? toRecord(relateGoods[0]) : null;
  const primaryRelateInfo = primaryRelate ? toRecord(primaryRelate.info) : null;
  const transParam = toRecord(raw.trans_param);

  const hash = pickText(
    raw.hash,
    raw.hash_128,
    primaryRelate?.hash,
    raw.hash_flac,
    raw.hash_320
  );
  if (!hash) {
    return null;
  }

  const rawSongname = pickText(raw.ori_audio_name, raw.songname, primaryRelate?.songname);
  const parsedFilename = splitArtistTitle(pickText(raw.filename, rawSongname));
  const title = pickText(rawSongname, parsedFilename.title);
  if (!title) {
    return null;
  }

  let artist = pickText(raw.author_name);
  if (!artist && Array.isArray(raw.singerinfo)) {
    const names = raw.singerinfo
      .map((item) => (typeof item === 'object' && item !== null ? pickText((item as Record<string, unknown>).name) : ''))
      .filter(Boolean);
    if (names.length) {
      artist = names.join('、');
    }
  }
  if (!artist) {
    artist = parsedFilename.artist || '未知歌手';
  }

  const album = pickText(
    primaryRelate?.albumname,
    raw.album_name,
    raw.albumname,
    primaryRelate?.album_name
  ) || undefined;

  const rawCover = pickText(
    primaryRelateInfo?.image,
    transParam.union_cover,
    raw.cover,
    raw.sizable_cover,
    raw.imgurl
  );
  const coverUrl = sizedImage(rawCover, 480);

  const albumId = pickStringLike(raw.album_id, primaryRelate?.album_id) || undefined;
  const albumAudioId = pickStringLike(
    primaryRelate?.album_audio_id,
    raw.mixsongid,
    raw.songid,
    raw.audio_id
  ) || undefined;

  const durationSec = pickNumber(raw.time_length, raw.duration, primaryRelateInfo?.duration);
  const durationMs = durationSec > 0 ? (durationSec < 1000 ? durationSec * 1000 : durationSec) : undefined;

  const privilege = pickNumber(raw.privilege);
  const vip = privilege >= 10 || undefined;
  const quality = detectAudioQuality(raw);

  return {
    hash,
    title,
    artist,
    album,
    coverUrl,
    albumId,
    albumAudioId,
    durationMs,
    vip,
    quality,
    source: 'radio',
  };
}

export interface FetchPersonalFmOptions {
  mode: PersonalFmMode;
  songPoolId: PersonalFmSongPoolId;
  action?: 'play' | 'garbage';
  currentTrack?: PlayerTrack | null;
  playtimeSeconds?: number;
  isOverplay?: boolean;
  remainSongCount?: number;
}

/**
 * 获取酷狗私人电台 (红心 Radio / 小众 Radio / 速览 Radio) 歌曲
 */
export async function fetchPersonalFmSongs(options: FetchPersonalFmOptions): Promise<PlayerTrack[]> {
  const {
    mode = 'normal',
    songPoolId = 0,
    action = 'play',
    currentTrack,
    playtimeSeconds,
    isOverplay,
    remainSongCount = 0,
  } = options;

  await bootstrapMobileApi();
  const session = getSessionSnapshot();

  const params: Record<string, unknown> = {
    mode,
    song_pool_id: songPoolId,
    action,
    platform: 'android',
    remain_songcnt: remainSongCount,
    is_overplay: isOverplay ? 1 : 0,
    cookie: {
      ...session,
      KUGOU_API_MID: session.KUGOU_API_MID || '-',
    },
  };

  if (currentTrack?.hash) {
    params.hash = currentTrack.hash;
  }
  if (currentTrack?.albumAudioId) {
    params.songid = currentTrack.albumAudioId;
  }
  if (typeof playtimeSeconds === 'number' && playtimeSeconds >= 0) {
    params.playtime = Math.round(playtimeSeconds);
  }

  try {
    const response = await mobileApi.personal_fm(params);
    const data = toRecord(toRecord(response.body).data);
    const rawSongs = toRecords(data.song_list);

    const tracks = rawSongs
      .map(normalizeRadioSong)
      .filter((song): song is PlayerTrack => Boolean(song?.hash));

    if (tracks.length > 0) {
      return tracks;
    }
  } catch (error) {
    console.warn('[PersonalFM] 拉取失败，尝试降级:', error);
  }

  // 降级兜底：调用榜单新歌作为电台保底
  try {
    const fallbackResponse = await mobileApi.top_song({ page: 1, pagesize: 10 });
    const fallbackData = toRecords(toRecord(fallbackResponse.body).data);
    return fallbackData
      .map(normalizeRadioSong)
      .filter((song): song is PlayerTrack => Boolean(song?.hash));
  } catch {
    return [];
  }
}

/**
 * 电台歌曲“不喜欢”操作上报
 * 报告 garbage 行为并返回推荐接口补齐的新歌曲
 */
export async function dislikePersonalFmSong(
  track: PlayerTrack,
  mode: PersonalFmMode,
  songPoolId: PersonalFmSongPoolId
): Promise<PlayerTrack[]> {
  return fetchPersonalFmSongs({
    mode,
    songPoolId,
    action: 'garbage',
    currentTrack: track,
    remainSongCount: 0,
  });
}
