import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/bank' },
  {
    path: '/bank',
    name: 'bank',
    component: () => import('../views/BankView.vue'),
    meta: { title: '题库' }
  },
  {
    path: '/questions/new',
    name: 'question-new',
    component: () => import('../views/EditorView.vue'),
    meta: { title: '录入题目' }
  },
  {
    path: '/questions/:id',
    name: 'question-detail',
    component: () => import('../views/DetailView.vue'),
    meta: { title: '题目详情' }
  },
  {
    path: '/questions/:id/edit',
    name: 'question-edit',
    component: () => import('../views/EditorView.vue'),
    meta: { title: '编辑题目' }
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('../views/LogsView.vue'),
    meta: { title: '操作记录' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { title: '设置与迁移' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/bank' }
];

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0, behavior: 'smooth' };
  }
});
