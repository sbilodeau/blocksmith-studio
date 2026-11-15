import { createRouter, createWebHashHistory, type Router, type RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import SettingsView from '../views/SettingsView.vue'
import PackView from '../views/PackView.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/pack/:packId', name: 'pack', component: PackView, props: true },
  { path: '/settings', name: 'settings', component: SettingsView }
]

export function createAppRouter(): Router {
  return createRouter({ history: createWebHashHistory(), routes })
}
