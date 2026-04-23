import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        products: resolve(__dirname, 'products.html'),
        community: resolve(__dirname, 'community.html'),
        live: resolve(__dirname, 'live.html'),
        forms: resolve(__dirname, 'forms.html'),
        faq: resolve(__dirname, 'faq.html'),
        support: resolve(__dirname, 'support.html'),
        cart: resolve(__dirname, 'cart.html'),
        auth: resolve(__dirname, 'auth.html'),
        product: resolve(__dirname, 'product.html'),
        profile: resolve(__dirname, 'profile.html'),
        editProfile: resolve(__dirname, 'edit-profile.html')
      }
    }
  }
})
