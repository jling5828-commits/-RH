import { UPSCALE_PROMPT } from "../../constants/upscalePrompt.js";
import { applyGradientMask, applyGradientMaskToImage } from "./applyGradientMask.js";

const TILE_OVERLAP_MAP = Object.freeze({
    none: 0,
    small: 32,
    medium: 64,
    large: 96,
});

function unavailableUpscaleApi(name) {
    return () => {
        throw new Error(`超清模块 ${name} 在当前小梁RH版本中不可用`);
    };
}

const runUpscale = unavailableUpscaleApi("runUpscale");
const computeTiles = unavailableUpscaleApi("computeTiles");
const tileToDataUrl = unavailableUpscaleApi("tileToDataUrl");

export {
    runUpscale,
    computeTiles,
    tileToDataUrl,
    TILE_OVERLAP_MAP,
    UPSCALE_PROMPT,
    applyGradientMask,
    applyGradientMaskToImage,
};
