import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 配置：告诉 Vite 用 React 插件编译 .jsx，并固定开发服务器端口。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  }
})
