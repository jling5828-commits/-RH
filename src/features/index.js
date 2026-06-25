import { ImageUpload as XiaoliangImageUpload } from "./imageUpload/index.js";
import { Operation as XiaoliangOperation, MuteButton as XiaoliangMuteButton } from "./operation/index.js";
import {
    OptionalParams as XiaoliangOptionalParams,
    Parameter as XiaoliangParameter,
    PromptSection as XiaoliangPromptSection,
} from "./params/index.js";
import { Results as XiaoliangResults } from "./results/index.js";

const featureExports = Object.freeze({
    ImageUpload: XiaoliangImageUpload,
    MuteButton: XiaoliangMuteButton,
    Operation: XiaoliangOperation,
    OptionalParams: XiaoliangOptionalParams,
    Parameter: XiaoliangParameter,
    PromptSection: XiaoliangPromptSection,
    Results: XiaoliangResults,
});

export const {
    ImageUpload,
    MuteButton,
    Operation,
    OptionalParams,
    Parameter,
    PromptSection,
    Results,
} = featureExports;
