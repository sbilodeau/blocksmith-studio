import { createRouter, createWebHashHistory, type Router, type RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import SettingsView from '../views/SettingsView.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/settings', name: 'settings', component: SettingsView }
]

export function createAppRouter(): Router {
  return createRouter({ history: createWebHashHistory(), routes })
}
