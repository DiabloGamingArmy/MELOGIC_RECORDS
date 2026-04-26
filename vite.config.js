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
        productDashboard: resolve(__dirname, 'product-dashboard.html'),
        auth: resolve(__dirname, 'auth.html'),
        product: resolve(__dirname, 'product.html'),
        inbox: resolve(__dirname, 'inbox.html'),
        profile: resolve(__dirname, 'profile.html'),
        profilePublic: resolve(__dirname, 'profile-public.html'),
        editProfile: resolve(__dirname, 'edit-profile.html'),
        newProduct: resolve(__dirname, 'new-product.html')
      }
    }
  }
})
