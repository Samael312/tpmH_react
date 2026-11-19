import { Config } from "@remotion/cli/config";

// WebGL (modelo 3D de Chipi) en Chrome sin pantalla: ANGLE en vez del render por software por defecto.
Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
