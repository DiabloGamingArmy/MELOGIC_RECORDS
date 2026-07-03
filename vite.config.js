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
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        refundPolicy: resolve(__dirname, 'refund-policy.html'),
        creatorGuidelines: resolve(__dirname, 'creator-guidelines.html'),
        adPolicy: resolve(__dirname, 'ad-policy.html'),
        studio: resolve(__dirname, 'studio.html'),
        stage: resolve(__dirname, 'stage.html'),
        instrumentHost: resolve(__dirname, 'instrument-host.html'),
        studioProject: resolve(__dirname, 'studio-project.html'),
        studioDemos: resolve(__dirname, 'studio-demos.html'),
        studioTutorials: resolve(__dirname, 'studio-tutorials.html'),
        distribution: resolve(__dirname, 'distribution.html'),
        cart: resolve(__dirname, 'cart.html'),
        productDashboard: resolve(__dirname, 'product-dashboard.html'),
        admin: resolve(__dirname, 'admin.html'),
        auth: resolve(__dirname, 'auth.html'),
        authAction: resolve(__dirname, 'auth-action.html'),
        product: resolve(__dirname, 'product.html'),
        inbox: resolve(__dirname, 'inbox.html'),
        accountSecurity: resolve(__dirname, 'account-security.html'),
        billingPayouts: resolve(__dirname, 'billing-payouts.html'),
        profile: resolve(__dirname, 'profile.html'),
        profilePublic: resolve(__dirname, 'profile-public.html'),
        library: resolve(__dirname, 'library.html'),
        orders: resolve(__dirname, 'orders.html'),
        editProfile: resolve(__dirname, 'edit-profile.html'),
        newProduct: resolve(__dirname, 'new-product.html')
      }
    }
  }
})
