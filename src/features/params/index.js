import { OptionalParams as OptionalParameterPanel } from "../../components/OptionalParams.jsx";
import { Parameter as CoreParameterPanel } from "../../components/Parameter.jsx";
import { PromptSection as PromptEditorSection } from "../../components/PromptSection.jsx";

const paramsFeature = Object.freeze({
    OptionalParams: OptionalParameterPanel,
    Parameter: CoreParameterPanel,
    PromptSection: PromptEditorSection,
});

export const { OptionalParams, Parameter, PromptSection } = paramsFeature;
