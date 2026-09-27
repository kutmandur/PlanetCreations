import {isReservedCommunitySlug} from './communityRoutes';
const REPORTABLE_ROUTES = Object.freeze({
    community: 'community',
    showcase: 'showcase',
    event: 'event',
    collaboration: 'collaboration',
});

export function getReportableContent(pathname) {
    if (typeof pathname !== 'string') return null;
    const match = pathname.match(/^\/(community|showcase|event|collaboration)\/([^/]+)\/?$/);
    if (!match) {
        const slug = pathname.match(/^\/([a-z0-9-]+)\/?$/)?.[1];
        return slug && !isReservedCommunitySlug(slug) ? {targetType:'community',targetSlug:slug,targetTitle:'Community content'} : null;
    }
    if (['create', 'join'].includes(match[2])) return null;
    const targetType = REPORTABLE_ROUTES[match[1]];
    let targetId;
    try {
        targetId = decodeURIComponent(match[2]).trim();
    } catch (error) {
        return null;
    }
    if (!targetId || targetId.length > 200) return null;
    if (targetType === 'community') return {targetType, targetSlug: targetId.toLowerCase(), targetTitle: 'Community content'};
    const markerId = encodeURIComponent(`${targetType}:${targetId}`);
    if (markerId.length > 1000) return null;
    return {
        markerId,
        targetId,
        targetPath: `/${match[1]}/${match[2]}`,
        targetTitle: `${targetType[0].toUpperCase()}${targetType.slice(1)} content`,
        targetType,
    };
}
