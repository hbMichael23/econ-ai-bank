import { defineStore } from 'pinia';
import {
  configError,
  isSupabaseConfigured,
  requireSupabase,
  setUserToken
} from '../lib/supabase.js';
import { setSession } from '../lib/session.js';
import { randomToken, getDeviceInfo } from '../lib/device.js';

const TOKEN_KEY = 'econ_ai_user_token';
const THEME_KEY = 'econ_ai_theme';

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useUserStore = defineStore('user', {
  state: () => ({
    ready: false,
    token: '',
    userSet: null,
    device: null,
    theme: preferredTheme(),
    imageMode: 'text_only',
    error: ''
  }),

  getters: {
    migrationKey: (state) => state.userSet?.migration_key || '',
    deviceLabel: (state) => state.device?.label || state.userSet?.device_label || '当前设备',
    imageModeLabel: (state) => (state.imageMode === 'cloud' ? '云端保存原图' : '只存识别文字'),
    isDark: (state) => state.theme === 'dark'
  },

  actions: {
    applyTheme() {
      const dark = this.theme === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1714' : '#f4f1e9');
    },

    setTheme(theme) {
      this.theme = theme === 'dark' ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, this.theme);
      this.applyTheme();
    },

    toggleTheme() {
      this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    async init() {
      this.applyTheme();
      if (!isSupabaseConfigured) throw new Error(configError);
      const supabase = requireSupabase();

      let token = localStorage.getItem(TOKEN_KEY) || '';
      if (!token) token = randomToken('ut_');
      setUserToken(token);

      const device = await getDeviceInfo();
      this.device = device;

      const { data: existing, error: selectError } = await supabase
        .from('user_set')
        .select('*')
        .eq('user_token', token)
        .maybeSingle();

      if (selectError && selectError.code !== 'PGRST116') throw selectError;

      let userSet = existing;
      if (!userSet) {
        const { data: created, error: insertError } = await supabase
          .from('user_set')
          .insert({
            user_token: token,
            migration_key: randomToken('mk_'),
            device_fingerprint: device.fingerprint,
            device_label: device.label,
            image_mode: 'text_only',
            last_seen_at: new Date().toISOString()
          })
          .select('*')
          .single();
        if (insertError) {
          throw new Error(`无法创建私有题库：${insertError.message}`);
        }
        userSet = created;
      }

      this.token = token;
      this.userSet = userSet;
      this.imageMode = userSet.image_mode === 'cloud' ? 'cloud' : 'text_only';
      localStorage.setItem(TOKEN_KEY, token);

      setSession({
        token,
        userSetId: userSet.id,
        deviceLabel: device.label,
        imageMode: this.imageMode
      });

      // 指纹只作为设备标识/审计辅助；真正的身份凭证是 256-bit token。
      const { error: updateError } = await supabase
        .from('user_set')
        .update({
          device_fingerprint: device.fingerprint,
          device_label: device.label,
          last_seen_at: new Date().toISOString()
        })
        .eq('id', userSet.id);
      if (!updateError) {
        this.userSet = {
          ...userSet,
          device_fingerprint: device.fingerprint,
          device_label: device.label
        };
      }

      this.ready = true;
      return userSet;
    },

    async importMigrationKey(rawKey) {
      const key = String(rawKey || '').trim();
      if (!key) throw new Error('请输入迁移密钥。');
      if (!/^mk_[A-Za-z0-9_-]{40,80}$/.test(key)) {
        throw new Error('迁移密钥格式不正确，应以 mk_ 开头。');
      }
      const supabase = requireSupabase();
      const previousToken = this.token || localStorage.getItem(TOKEN_KEY) || '';

      const { data, error } = await supabase.rpc('redeem_migration_key', { p_key: key });
      if (error) throw error;
      const nextToken = data?.[0]?.user_token;
      if (!nextToken) throw new Error('迁移密钥不存在或已失效，请检查后重试。');

      setUserToken(nextToken);
      const { data: userSet, error: selectError } = await supabase
        .from('user_set')
        .select('id')
        .eq('user_token', nextToken)
        .maybeSingle();
      if (selectError || !userSet) {
        setUserToken(previousToken);
        throw new Error('迁移目标题库读取失败，请确认迁移密钥和 Supabase 配置。');
      }

      localStorage.setItem(TOKEN_KEY, nextToken);
      setSession({ token: nextToken, userSetId: userSet.id });
      window.location.reload();
      return nextToken;
    },

    async setImageMode(mode) {
      const next = mode === 'cloud' ? 'cloud' : 'text_only';
      const supabase = requireSupabase();
      const { error } = await supabase
        .from('user_set')
        .update({ image_mode: next })
        .eq('id', this.userSet.id);
      if (error) throw error;
      this.imageMode = next;
      this.userSet = { ...this.userSet, image_mode: next };
      setSession({ imageMode: next });
    }
  }
});
