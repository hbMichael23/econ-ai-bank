import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'katex/dist/katex.min.css';
import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import './styles/main.css';

import App from './App.vue';
import router from './router/index.js';
import { useUserStore } from './stores/user.js';

function showBootError(error) {
  console.error('启动失败', error);
  const boot = document.getElementById('boot');
  if (!boot) return;
  const message = String(error?.message || error || '未知错误');
  boot.innerHTML = `
    <div class="boot-card boot-error">
      <div class="boot-mark">!</div>
      <h1>题库没有打开</h1>
      <p class="boot-error-message"></p>
      <p class="boot-error-hint">请检查 Supabase 环境变量、建表 SQL 和网络连接，然后刷新页面。</p>
      <button id="boot-retry" type="button">重新加载</button>
    </div>
  `;
  boot.querySelector('.boot-error-message').textContent = message;
  boot.querySelector('#boot-retry')?.addEventListener('click', () => window.location.reload());
}

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(ElementPlus, { locale: zhCn });
  app.use(router);

  const userStore = useUserStore(pinia);
  try {
    await userStore.init();
    router.afterEach((to) => {
      const title = to.meta?.title;
      document.title = title ? `${title} · 经济学考研私有 AI 题库` : '经济学考研私有 AI 题库';
    });
    await router.isReady();
    app.mount('#app');
    document.getElementById('boot')?.remove();
    document.documentElement.dataset.ready = 'true';
  } catch (error) {
    showBootError(error);
  }
}

bootstrap();
