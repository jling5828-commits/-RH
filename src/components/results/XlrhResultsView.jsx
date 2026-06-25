import React from "react";
import {
    IconDeleteAll,
    IconDeleteCurrent,
    IconFeather,
    IconFolder,
    IconFolderSmall,
    IconJumpToNewest,
    IconJumpToOldest,
    IconNavNext,
    IconNavPrev,
    IconNewDoc,
    IconPlace,
    IconRefresh,
    IconTrash,
} from "./XlrhResultIcons.jsx";

function stopEvent(handler) {
    return (event) => {
        event.stopPropagation();
        handler?.(event);
    };
}

function blockEvent(handler) {
    return (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler?.(event);
    };
}

function XlrhNoFolderState({ onPickFolder }) {
    return (
        <div className="xres-stage">
            <div className="xres-canvas">
                <div
                    className="xres-blank"
                    title="未选择时，返图将使用临时磁盘；插件重启后不保留。选择后可持久保存到本地文件夹。"
                >
                    <IconFolder />
                    <span>选择本地存储</span>
                    <div className="xres-blank-action xres-primary" onClick={onPickFolder}>
                        选择本地存储文件夹
                    </div>
                </div>
            </div>
        </div>
    );
}

function XlrhEmptyFolderState({ folderName, isTemporary, onPickFolder }) {
    return (
        <div className="xres-stage">
            <div className="xres-canvas">
                <div className="xres-blank">
                    <span>文件夹为空</span>
                    <span className="xres-folder-chip">
                        {folderName}
                        {isTemporary ? <span className="xres-folder-chip-suffix"> · 临时</span> : null}
                    </span>
                    <div className="xres-blank-action xres-subtle" onClick={onPickFolder}>
                        切换本地存储文件夹
                    </div>
                </div>
            </div>
        </div>
    );
}

function XlrhViewport({ errorMsg, isLoadingImg, currentImgUrl }) {
    if (errorMsg) {
        return (
            <div className="xres-error">
                <span className="xres-error-tag">ERROR</span>
                <span className="xres-error-copy">{errorMsg}</span>
            </div>
        );
    }
    if (isLoadingImg) {
        return (
            <div className="xres-loading">
                <div className="xres-spinner" />
                <span className="xres-loading-copy">LOADING</span>
            </div>
        );
    }
    if (currentImgUrl) return <img src={currentImgUrl} className="xres-image" alt="Result" />;
    return (
        <div className="xres-blank">
            <span className="xres-loading-copy">WAITING</span>
        </div>
    );
}

function XlrhSideRail({ side, disabled, edge, onMove, onJump, showJump, title, jumpTitle }) {
    const ArrowIcon = side === "left" ? IconNavPrev : IconNavNext;
    const JumpIcon = side === "left" ? IconJumpToOldest : IconJumpToNewest;
    return (
        <div className={`xres-side-nav xres-side-nav--${side}`}>
            <div
                className={`xres-side-arrow xres-${side} ${disabled ? "xres-disabled" : ""} ${edge ? "xres-edge" : ""}`}
                onClick={onMove}
                title={disabled ? "" : title}
            >
                <ArrowIcon />
            </div>
            {!disabled ? (
                <div className="xres-jump-slot">
                    {showJump ? (
                        <button type="button" className="xres-jump-button" onClick={blockEvent(onJump)} title={jumpTitle}>
                            <JumpIcon />
                        </button>
                    ) : (
                        <div className="xres-jump-spacer" aria-hidden />
                    )}
                </div>
            ) : null}
        </div>
    );
}

function XlrhHeaderStrip({ folderPathPrefix, fullFolderTitle, fileName, isTemporary, onRefresh }) {
    return (
        <div className="xres-header">
            <div className="xres-header-name-row">
                {folderPathPrefix ? (
                    <span className="xres-header-prefix" title={fullFolderTitle}>
                        {folderPathPrefix}
                    </span>
                ) : null}
                <span className="xres-header-name">{fileName}</span>
            </div>
            <div className="xres-header-actions">
                <span className={`xres-header-badge ${isTemporary ? "xres-temp" : ""}`}>
                    {isTemporary ? "TEMP" : "LOCAL"}
                </span>
                <button type="button" className="xres-header-refresh" onClick={stopEvent(onRefresh)} title="刷新文件列表">
                    <IconRefresh />
                </button>
            </div>
        </div>
    );
}

function XlrhCounter({ counter, inputRef }) {
    return (
        <div className="xres-toolbar-mid">
            <div
                className={`xres-page-wrap ${counter.editing ? "xres-page-wrap--edit" : ""}`}
                onClick={stopEvent(counter.beginEdit)}
            >
                {counter.editing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        className="xres-page-input"
                        value={counter.value}
                        onChange={(event) => counter.setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") counter.submit();
                            if (event.key === "Escape") counter.cancel();
                        }}
                        style={{ width: `${counter.size * 14 + 20}px` }}
                        autoFocus
                    />
                ) : (
                    <span className="xres-page-display">
                        <span className="xres-page-current">{counter.fromNewest}</span>
                        <span className="xres-page-sep">/</span>
                        <span className="xres-page-total">{counter.total}</span>
                    </span>
                )}
            </div>
        </div>
    );
}

function XlrhFeatherPopup({ popover, enabled, keepSelection, onEnabledChange, onKeepSelectionChange }) {
    return (
        <div ref={popover.rootRef} className="xres-tool-wrap" {...popover.wrapHoverProps}>
            <button
                type="button"
                className={`xres-tool-button xres-primary ${enabled ? "xres-active" : ""}`}
                onClick={stopEvent(popover.toggle)}
                title="边缘软边"
            >
                <IconFeather />
                <span>边缘</span>
            </button>
            {popover.visible ? (
                <div className={`xres-feather-menu ${popover.closing ? "xres-feather-menu--closing" : ""}`} {...popover.menuHoverProps}>
                    <div className="xres-feather-title"><span>置入边缘软边</span></div>
                    <div className="xres-feather-body">
                        <div className="xres-feather-row">
                            <label className="xres-feather-label">
                                <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
                                <span>启用边缘软边</span>
                            </label>
                        </div>
                        <div className="xres-feather-row">
                            <label className="xres-feather-label">
                                <input type="checkbox" checked={keepSelection} onChange={(event) => onKeepSelectionChange(event.target.checked)} />
                                <span>保留选区</span>
                            </label>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function XlrhDeletePopup({ popover, onDeleteCurrent, onClearAll }) {
    return (
        <div ref={popover.rootRef} className="xres-tool-wrap" {...popover.wrapHoverProps}>
            <button type="button" className="xres-tool-button" onClick={stopEvent(popover.toggle)} title="删除">
                <IconTrash />
                <span>删除</span>
            </button>
            {popover.visible ? (
                <div className={`xres-delete-menu ${popover.closing ? "xres-delete-menu--closing" : ""}`} {...popover.menuHoverProps}>
                    <button type="button" className="xres-delete-menu-item" onClick={stopEvent(onDeleteCurrent)}>
                        <IconDeleteCurrent />
                        <span>删除当前</span>
                    </button>
                    <button type="button" className="xres-delete-menu-item xres-delete-menu-item--danger" onClick={stopEvent(onClearAll)}>
                        <IconDeleteAll />
                        <span>清空全部</span>
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function XlrhToolbar({ autoPlace, counter, counterInputRef, feather, deleteMenu, actions }) {
    return (
        <div className="xres-toolbar">
            <div className="xres-toolbar-start">
                <button
                    type="button"
                    className="xres-tool-button"
                    onClick={stopEvent(actions.placeToCanvas)}
                    onContextMenu={blockEvent(actions.toggleAutoPlace)}
                    title={autoPlace ? "右键关闭自动置入" : "右键开启自动置入"}
                >
                    <IconPlace />
                    <span>置入</span>
                </button>
                <button type="button" className="xres-tool-button" onClick={stopEvent(actions.openNewDoc)} title="在新文档中打开">
                    <IconNewDoc />
                    <span>新文档</span>
                </button>
            </div>
            <XlrhCounter counter={counter} inputRef={counterInputRef} />
            <div className="xres-toolbar-end">
                <XlrhFeatherPopup {...feather} />
                <XlrhDeletePopup {...deleteMenu} />
            </div>
        </div>
    );
}

function XlrhConfirmClear({ open, onCancel, onConfirm }) {
    if (!open) return null;
    return (
        <div className="xres-clear-shade" onClick={onCancel}>
            <div className="xres-clear-card" onClick={(event) => event.stopPropagation()}>
                <div className="xres-clear-header">
                    <span className="xres-clear-icon">!</span>
                    <span className="xres-clear-title">确认清空</span>
                </div>
                <div className="xres-clear-body">
                    <span>只清空小梁RH生成的返图，不会删除文件夹内其它文件。</span>
                </div>
                <div className="xres-clear-actions">
                    <button type="button" className="xres-clear-button xres-cancel" onClick={onCancel}>取消</button>
                    <button type="button" className="xres-clear-button xres-confirm" onClick={onConfirm}>确认清空</button>
                </div>
            </div>
        </div>
    );
}

function XlrhFolderDock({ folderName, popover, canRestoreInitial, onPickFolder, onRestoreInitial, onUnbindFolder }) {
    return (
        <div ref={popover.rootRef} className={`xres-folder-button-wrap ${popover.visible ? "xres-active" : ""}`} {...popover.wrapHoverProps}>
            <button type="button" className="xres-folder-button" onClick={stopEvent(popover.toggle)}>
                <IconFolderSmall />
                <span className="xres-folder-button-text">{folderName}</span>
            </button>
            {popover.visible ? (
                <div className={`xres-folder-menu ${popover.closing ? "xres-folder-menu--closing" : ""}`} {...popover.menuHoverProps}>
                    <div className="xres-folder-title">存储设置</div>
                    <button type="button" className="xres-folder-item" onClick={stopEvent(onPickFolder)}>
                        <IconFolderSmall />
                        <span>选择文件夹</span>
                    </button>
                    {canRestoreInitial ? (
                        <button type="button" className="xres-folder-item" onClick={stopEvent(onRestoreInitial)}>
                            <IconRefresh />
                            <span>恢复为初始目录</span>
                        </button>
                    ) : null}
                    <button type="button" className="xres-folder-item xres-folder-item--danger" onClick={stopEvent(onUnbindFolder)}>
                        <IconTrash />
                        <span>取消绑定</span>
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export function XlrhResultsView({ model, navigation, counter, popovers, actions }) {
    if (!model.userFolder) return <XlrhNoFolderState onPickFolder={actions.pickFolder} />;
    if (model.fileCount === 0) {
        return (
            <XlrhEmptyFolderState
                folderName={model.userFolder.name}
                isTemporary={model.isTemporaryFolder}
                onPickFolder={actions.pickFolder}
            />
        );
    }

    return (
        <div className="xres-stage" onMouseEnter={actions.hoverOn} onMouseLeave={actions.hoverOff}>
            <div className="xres-canvas">
                <XlrhViewport errorMsg={model.errorMsg} isLoadingImg={model.isLoadingImg} currentImgUrl={model.currentImgUrl} />
            </div>
            <XlrhSideRail
                side="left"
                disabled={!navigation.canLoop}
                edge={navigation.leftOnBoundary}
                onMove={navigation.moveLeft}
                showJump={navigation.showOldestJump}
                onJump={navigation.jumpOldest}
                title={navigation.leftTitle}
                jumpTitle="跳到最旧一张"
            />
            <XlrhSideRail
                side="right"
                disabled={!navigation.canLoop}
                edge={navigation.rightOnBoundary}
                onMove={navigation.moveRight}
                showJump={navigation.showNewestJump}
                onJump={navigation.jumpNewest}
                title={navigation.rightTitle}
                jumpTitle="跳到最新一张"
            />
            <div className={`xres-overlay ${model.isHovered ? "xres-visible" : ""}`}>
                <XlrhHeaderStrip
                    folderPathPrefix={model.folderPathPrefix}
                    fullFolderTitle={model.folderTitle}
                    fileName={model.currentFileName}
                    isTemporary={model.isTemporaryFolder}
                    onRefresh={actions.refreshFiles}
                />
                <XlrhToolbar
                    autoPlace={model.autoPlace}
                    counter={counter}
                    counterInputRef={model.counterInputRef}
                    feather={popovers.feather}
                    deleteMenu={popovers.deleteMenu}
                    actions={actions}
                />
            </div>
            <XlrhConfirmClear open={model.showClearConfirm} onCancel={actions.cancelClearAll} onConfirm={actions.confirmClearAll} />
            <XlrhFolderDock
                folderName={model.userFolder.name}
                popover={popovers.folder}
                canRestoreInitial={model.canRestoreInitialFolder}
                onPickFolder={actions.pickFolder}
                onRestoreInitial={actions.restoreInitialFolder}
                onUnbindFolder={actions.unbindFolder}
            />
        </div>
    );
}
