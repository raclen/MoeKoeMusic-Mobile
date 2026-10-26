import * as SecureStore from 'expo-secure-store';

import { showToast } from '@/components/ui/toast';
import { getSettingsState } from '@/features/settings/store';
import { pickNumber, pickText, toRecord } from '@/lib/api-parse';
import { bootstrapMobileApi, getApiSession, mobileApi } from '@/lib/kugou-api';

export type VipSignInResult = {
  message: string;
  /** 是否是“今天已签到”这类非错误的提示（用于区分成功/中性/失败的展示）。 */
  alreadyDone: boolean;
  /** 签到态正常（成功或今天已签），可以继续询问升级概念版 VIP；风控等异常不给升级入口。 */
  canUpgrade?: boolean;
};

const VIP_CLAIM_STORAGE_PREFIX = 'moekoe.vip.last_claim.';
const inMemoryClaimDate: Record<string, string> = {};

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getClaimKey(userid?: string): string {
  return `${VIP_CLAIM_STORAGE_PREFIX}${userid || getApiSession().userid || 'default'}`;
}

export async function isVipClaimedToday(userid?: string): Promise<boolean> {
  const today = getTodayDateString();
  const user = userid || getApiSession().userid || 'default';
  if (inMemoryClaimDate[user] === today) {
    return true;
  }
  try {
    const stored = await SecureStore.getItemAsync(getClaimKey(user));
    if (stored === today) {
      inMemoryClaimDate[user] = today;
      return true;
    }
  } catch {
    // Ignore storage read failures.
  }
  return false;
}

export async function markVipClaimedToday(userid?: string): Promise<void> {
  const today = getTodayDateString();
  const user = userid || getApiSession().userid || 'default';
  inMemoryClaimDate[user] = today;
  try {
    await SecureStore.setItemAsync(getClaimKey(user), today);
  } catch {
    // Ignore storage write failures.
  }
}

function todayKey(): string {
  return getTodayDateString();
}

/** 提取酷狗返回体里的错误码，兼容 { error_code } 与包在 body 里的两种形态。 */
function pickErrorCode(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 0;
  }
  const record = error as Record<string, unknown>;
  const bodyCode = pickNumber(toRecord(record.body).error_code);
  if (bodyCode) {
    return bodyCode;
  }
  const responseCode = pickNumber(toRecord(toRecord(record.response).data).error_code);
  if (responseCode) {
    return responseCode;
  }
  const direct = pickNumber(record.error_code, record.status);
  if (direct) {
    return direct;
  }
  return 0;
}

/**
 * 概念版每日签到：领取 1 天畅听 VIP。
 * 对应桌面端「个人中心 → 签到」调用的 /youth/day/vip。
 */
export async function signInDailyVip(): Promise<VipSignInResult> {
  await bootstrapMobileApi();

  try {
    const response = await mobileApi.youth_day_vip({ receive_day: todayKey() });
    const body = toRecord(response.body);
    if (pickNumber(body.status) === 1) {
      await markVipClaimedToday();
      return { message: '签到成功，获得 1 天畅听 VIP', alreadyDone: false, canUpgrade: true };
    }
    const msg = pickText(body.error_msg);
    return { message: msg || '签到失败，请稍后重试', alreadyDone: false };
  } catch (error) {
    const code = pickErrorCode(error);
    if (code === 131001) {
      await markVipClaimedToday();
      return { message: '你今天已经签到过了', alreadyDone: true, canUpgrade: true };
    }
    if (code === 20028) {
      return { message: '当前账号存在风控，请前往手机酷狗领取', alreadyDone: true };
    }
    const msg = pickText(toRecord((error as Record<string, unknown>)?.body).error_msg);
    throw new Error(msg || `签到失败${code ? `（${code}）` : ''}`);
  }
}

/**
 * 升级为概念版 VIP（更高音质），一天仅一次。
 * 对应桌面端 /youth/day/vip/upgrade。
 */
export async function upgradeDailyVip(): Promise<VipSignInResult> {
  await bootstrapMobileApi();

  try {
    const response = await mobileApi.youth_day_vip_upgrade({
      userid: getApiSession().userid,
    });
    const body = toRecord(response.body);
    if (pickNumber(body.status) === 1) {
      await markVipClaimedToday();
      return { message: '升级成功，获得 1 天概念版 VIP', alreadyDone: false };
    }
    const msg = pickText(body.error_msg);
    return { message: msg || '升级失败，一天仅限一次', alreadyDone: true };
  } catch (error) {
    const code = pickErrorCode(error);
    if (code === 131001) {
      await markVipClaimedToday();
      return { message: '你今天已经签到过了', alreadyDone: true };
    }
    if (code === 20028) {
      return { message: '当前账号风控,请前往手机端领取', alreadyDone: true };
    }
    const msg = pickText(toRecord((error as Record<string, unknown>)?.body).error_msg);
    throw new Error(msg || '升级 VIP 失败，一天仅限一次');
  }
}

let autoClaimingInProgress = false;

/**
 * 每日打开应用自动签到领取 VIP。
 * 遵循设置中的开关，一天仅执行一次，避免重复请求。
 */
export async function runDailyAutoClaim(options?: {
  force?: boolean;
  silent?: boolean;
}): Promise<boolean> {
  if (autoClaimingInProgress) {
    return false;
  }

  const settings = getSettingsState();
  if (!settings.autoClaimVip && !options?.force) {
    return false;
  }

  autoClaimingInProgress = true;
  try {
    await bootstrapMobileApi();
    const session = getApiSession();
    if (!session.userid || session.userid === '0' || !session.token) {
      return false;
    }

    const alreadyClaimed = await isVipClaimedToday(session.userid);
    if (alreadyClaimed && !options?.force) {
      return false;
    }

    const result = await signInDailyVip();
    await markVipClaimedToday(session.userid);

    if (result.canUpgrade) {
      try {
        await upgradeDailyVip();
      } catch {
        // 静默升级失败不阻断整体流程
      }
    }

    if (!result.alreadyDone && !options?.silent) {
      showToast('已自动完成今日 VIP 签到 ✨');
    }
    return true;
  } catch {
    // 自动领取遇到网络等异常静默处理，避免影响正常使用
    return false;
  } finally {
    autoClaimingInProgress = false;
  }
}
