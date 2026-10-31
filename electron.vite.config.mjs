import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@common": resolve("src/common"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          pet: resolve("src/renderer/pet/index.html"),
          backpack: resolve("src/renderer/backpack/index.html"),
          settings: resolve("src/renderer/settings/index.html"),
          onboarding: resolve("src/renderer/onboarding/index.html"),
        },
      },
    },
  },
});
