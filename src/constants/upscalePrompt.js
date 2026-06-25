const UPSCALE_PROMPT_LINES = Object.freeze([
    "在不改变原图构图、主体位置和光影关系的前提下，提升整张图的清晰度、细节层次和真实质感。",
    "如果画面中有人像或皮肤，请保持皮肤自然干净，只做细腻修复，不要生成夸张毛孔、颗粒噪点、过度锐化纹理或不存在的皮肤细节。",
    "保持原有色彩、明暗、透视和元素数量，不添加新物体，不移动已有元素，不改变主体身份和画面含义。",
]);

export const UPSCALE_PROMPT = UPSCALE_PROMPT_LINES.join("");
