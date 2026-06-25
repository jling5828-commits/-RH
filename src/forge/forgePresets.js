export const FORGE_FACTORY_PRESETS = Object.freeze([
    {
        "id": "ff_001",
        "name": "基础修脸",
        "category": "head",
        "data": {
            "model": "majicmixRealistic_v4.safetensors [f954946633]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.28",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),best quality,high resolution,unity 8k wallpaper,(illustration:1),beautiful detailed eyes:,extremely detailed face,perfect lighting,photo_\\\\(medium\\\\),photorealistic,realistic, 1girl, solo,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_002",
        "name": "磨皮",
        "category": "head",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.33",
            "imageCount": "3",
            "resolution": "2048",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),smooth skin, blemish free skin, HD skin texture,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "",
            "controlNetModel": "",
            "controlNetWeight": "1.1",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_003",
        "name": "下颌优化和生成",
        "category": "head",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.35",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),best quality,high resolution,unity 8k wallpaper,(illustration:1),beautiful detailed eyes:,extremely detailed face,perfect lighting,photo_\\\\(medium\\\\),photorealistic,realistic, 1girl, solo,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_004",
        "name": "有腮红平整修脸无锁边",
        "category": "head",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "yiyuyun-zhuangrong-000005",
            "loraWeight": "0.8",
            "redrawAmount": "0.3",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),smooth skin, blemish free skin, HD skin texture,,yiyuyun,1girl,solo,portrait,realistic,close-up,black hair,bangs,brown hair,looking at viewer,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_005",
        "name": "有腮红平整修脸重锁边",
        "category": "head",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "yiyuyun-zhuangrong-000005",
            "loraWeight": "0.8",
            "redrawAmount": "0.34",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),smooth skin, blemish free skin, HD skin texture,,yiyuyun,1girl,solo,portrait,realistic,close-up,black hair,bangs,brown hair,looking at viewer,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "lineart_realistic",
            "controlNetModel": "control_v11p_sd15_lineart [43d4be0d]",
            "controlNetWeight": "1.1",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_006",
        "name": "中度修脸无锁边",
        "category": "head",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.3",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),best quality,high resolution,unity 8k wallpaper,(illustration:1),beautiful detailed eyes:,extremely detailed face,perfect lighting,photo_\\\\(medium\\\\),photorealistic,realistic, 1girl, solo,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_007",
        "name": "毛发材质优化",
        "category": "hair",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "FAXING-SD1.5",
            "loraWeight": "0.8",
            "redrawAmount": "0.37",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),((HD hair texture, hair, dynamic hair, broken hair, flying hair,layered hair,visible strands,black hair))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "",
            "controlNetModel": "",
            "controlNetWeight": "1.1",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_008",
        "name": "毛发材质优化高精度有锁边",
        "category": "hair",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "FAXING-SD1.5",
            "loraWeight": "0.8",
            "redrawAmount": "0.39",
            "imageCount": "3",
            "resolution": "1536",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),((HD hair texture, hair, dynamic hair, broken hair, flying hair,layered hair,visible strands,black hair))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "lineart_realistic",
            "controlNetModel": "control_v11p_sd15_lineart [43d4be0d]",
            "controlNetWeight": "1.1",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_009",
        "name": "头发优化",
        "category": "hair",
        "data": {
            "model": "majicmixRealistic_v4.safetensors [f954946633]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.28",
            "imageCount": "3",
            "resolution": "2048",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),((HD hair texture, hair, dynamic hair, broken hair, flying hair))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_010",
        "name": "南半球",
        "category": "torso",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "辅助生成南半球,搭配upshirt, underboob两词启用,极大概率生成NSFW内容,慎用",
            "loraWeight": "0.4",
            "redrawAmount": "0.4",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW,best quality, ultra high res, extreme_detail,soft focus, (photorealistic:1.4), masterpiece,((big tits, cleavage, big boobs)),(upshirt,underboob)",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_011",
        "name": "皮肤抹油",
        "category": "torso",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "皮肤抹油,有概率出现NSFW内容,慎用",
            "loraWeight": "0.6",
            "redrawAmount": "0.35",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece, (ulzzang-6500:0.8),(masterpiece:1.2),smooth skin, blemish free skin, HD skin texture,",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "lineart_realistic",
            "controlNetModel": "control_v11p_sd15_lineart [43d4be0d]",
            "controlNetWeight": "0.7",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_012",
        "name": "腿部优化",
        "category": "legs",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "",
            "loraWeight": "0.6",
            "redrawAmount": "0.35",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW,best quality, ultra high res, extreme_detail,soft focus, (photorealistic:1.4), masterpiece,((Slender legs, female legs, smooth skin, no muscle lines))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "lineart_realistic",
            "controlNetModel": "control_v11p_sd15_lineart [43d4be0d]",
            "controlNetWeight": "0.7",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_013",
        "name": "腿部优化（有黑丝）",
        "category": "legs",
        "data": {
            "model": "xxmix9realistic_v40.safetensors [5f41c4861c]",
            "lora": "5D左右薄黑丝纹理优化,权重请开到1以上",
            "loraWeight": "0.6",
            "redrawAmount": "0.35",
            "imageCount": "3",
            "resolution": "768",
            "positivePrompt": "8k RAW,best quality, ultra high res, extreme_detail,soft focus, (photorealistic:1.4), masterpiece,((Slender legs, female legs, smooth skin, no muscle lines)), (Black stockings, female thighs)",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "lineart_realistic",
            "controlNetModel": "control_v11p_sd15_lineart [43d4be0d]",
            "controlNetWeight": "0.7",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_014",
        "name": "胸部增大（可能出现NSFW）",
        "category": "torso",
        "data": {
            "model": "majicmixRealistic_v4.safetensors [f954946633]",
            "lora": "肉感,大胸,勒肉,请搭配液化食用",
            "loraWeight": "0.4",
            "redrawAmount": "0.4",
            "imageCount": "3",
            "resolution": "2048",
            "positivePrompt": "8k RAW,best quality, ultra high res, extreme_detail,soft focus, (photorealistic:1.4), masterpiece,((big tits, cleavage, big boobs))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    },
    {
        "id": "ff_015",
        "name": "无影棚刷漆",
        "category": "background",
        "data": {
            "model": "leosamsHelloworldSDXL_helloworldSDXL32DPO.safetensors [22c686a9f4]",
            "lora": "",
            "loraWeight": "0",
            "redrawAmount": "0.41",
            "imageCount": "3",
            "resolution": "2048",
            "positivePrompt": "8k RAW, best quality, ultra high res, extreme_detail, sharp focus, (photorealistic:1.4), masterpiece,,((Clean floor, white painted floor, white no studio, white studio, clean white wall))",
            "negativePrompt": "paintings, sketches, (worst quality:2), (low quality:2), (normal quality:2), lowres, normal quality, ((monochrome)), ((grayscale)), skin spots, acnes, skin blemishes, age spot, glans, anime, watermark, username, signature, text",
            "selectedControlNetModule": "None",
            "controlNetModel": "None",
            "controlNetWeight": "",
            "step": "20",
            "selectedName": "DPM++ 2M",
            "selectedScheduler": "automatic"
        }
    }
]);
