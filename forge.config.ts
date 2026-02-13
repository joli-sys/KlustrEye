import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
    name: "KlustrEye",
    executableName: "klustreye",
    icon: "./build/icon",
    ignore: [
      // Exclude dev/source files not needed at runtime
      /^\/(\.git|\.next\/cache|node_modules\/\.cache|\.env)/,
    ],
  },
  makers: [
    new MakerZIP({}, ["darwin", "linux", "win32"]),
  ],
  plugins: [],
};

export default config;
