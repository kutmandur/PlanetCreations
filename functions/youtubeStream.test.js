"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createYoutubeStreamService, parseYoutubeStreamUrl} = require("./youtubeStream");
const {parseYoutubePlayerMetadata, parseYoutubeLiveCandidates,
    extractYoutubeChannelId} = require("./youtubeFeed");
const channel = "UCybOJKIuOoi26Huw5X6ysjw";
const videoId = "WYAuABQAB5Q";
const player = (video = {}, live = {isLiveNow: true}, status = "OK") =>
    "<script>var ytInitialPlayerResponse = " + JSON.stringify({
        playabilityStatus: {status},
        videoDetails: {videoId, channelId: channel, title: "bot testing", isLiveContent: true, ...video},
        microformat: {playerMicroformatRenderer: {liveBroadcastDetails: live}},
    }) + ";</script>";
const channelPage = (contents = {}) => "<script>var ytInitialData = " +
    JSON.stringify({metadata: {channelMetadataRenderer: {externalId: channel}}, contents}) + ";</script>";
const liveContents = {items: [{lockupViewModel: {contentId: videoId,
    metadata: {lockupMetadataViewModel: {title: {content: "bot testing"}}},
    contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentImage: {thumbnailViewModel: {
        overlays: [{thumbnailBottomOverlayViewModel: {badges: [{
            thumbnailBadgeViewModel: {badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"},
        }]}}],
    }}}}]};
const response = (body, status = 200) => ({
    ok: status === 200, status, text: async () => body, json: async () => body,
});
const quota = () => response({error: {errors: [{reason: "quotaExceeded"}]}}, 403);
const apiVideo = (ended = false) => ({items: [{id: videoId,
    snippet: {channelId: channel, title: "bot testing", liveBroadcastContent: "live"},
    liveStreamingDetails: ended ? {actualEndTime: "2026-09-15T03:00:00Z"} : {},
}]});

test("accepts channel, handle, streams, live and direct video URLs", () => {
    for (const path of ["/@builder", "/@builder/live", "/channel/" + channel + "/streams"]) {
        assert.ok(parseYoutubeStreamUrl("https://youtube.com" + path)?.youtubeChannelUrl);
    }
    for (const url of ["https://youtu.be/" + videoId,
        "https://youtube.com/live/" + videoId, "https://youtube.com/watch?v=" + videoId]) {
        assert.equal(parseYoutubeStreamUrl(url).youtubeVideoId, videoId);
    }
    for (const url of ["https://youtu.be/@builder", "http://youtube.com/@builder",
        "https://youtube.com.evil.test/@builder", "https://youtube.com/watch?v=bad"]) {
        assert.equal(parseYoutubeStreamUrl(url), null);
    }
});
test("channel resolution uses owner metadata, not a recommended video", async () => {
    const html = '{"channelId":"UC_x5XG1OV2P6uZZ5FSM9Ttw"}' + channelPage();
    assert.equal(await extractYoutubeChannelId("https://youtube.com/@builder",
        async () => response(html)), channel);
});
test("player handles real cloud format with isLive but missing microformat", () => {
    assert.equal(parseYoutubePlayerMetadata(player({isLive: true}, undefined)).isLive, true);
    assert.equal(parseYoutubePlayerMetadata(player({isLive: true}, {})).isLive, true);
});
test("archives and scheduled broadcasts cannot become live through isLiveContent", () => {
    for (const html of [
        player({isPostLiveDvr: true}, {isLiveNow: true}),
        player({}, {isLiveNow: true, endTimestamp: "2026-09-15T02:29:22Z"}),
        player({isUpcoming: true}, {isLiveNow: false}, "LIVE_STREAM_OFFLINE"),
    ]) assert.equal(parseYoutubePlayerMetadata(html).isLive, false);
    assert.equal(parseYoutubePlayerMetadata(player({}, {})).isLive, null);
    assert.equal(parseYoutubePlayerMetadata(player({}, {}, "LOGIN_REQUIRED")).isLive, null);
    assert.throws(() => parseYoutubePlayerMetadata("<html>Consent</html>"));
    assert.throws(() => parseYoutubePlayerMetadata(player(), "abcdefghijk"));
});
test("live candidates support both YouTube layouts and ignore recommendations", () => {
    const content = {...liveContents, old: {videoRenderer: {videoId: "abcdefghijk",
        badges: [{metadataBadgeRenderer: {style: "BADGE_STYLE_TYPE_LIVE_NOW"}}]}}};
    assert.deepEqual(parseYoutubeLiveCandidates(channelPage(content), channel), [videoId, "abcdefghijk"]);
    assert.deepEqual(parseYoutubeLiveCandidates(channelPage(), channel), []);
    assert.throws(() => parseYoutubeLiveCandidates(channelPage(content), "UC_x5XG1OV2P6uZZ5FSM9Ttw"));
});
test("channel -> stale scheduled /live -> Streams tab -> quota fallback -> stable session metadata", async () => {
    let clock = 100000;
    const calls = [];
    let ended = false;
    const service = createYoutubeStreamService({apiKey: "test", now: () => clock, logger: {warn() {}},
        fetchImpl: async (url) => {
            calls.push(url);
            if (url.includes("googleapis.com")) return quota();
            if (url.includes("/streams?")) return response(channelPage(liveContents));
            if (url.includes("/live?")) return response(player({isUpcoming: true}, {}, "LIVE_STREAM_OFFLINE"));
            if (url.includes("/watch?")) return response(ended ?
                player({isPostLiveDvr: true}, {isLiveNow: false}) : player());
            return response(channelPage());
        }});
    const target = await service.resolve(parseYoutubeStreamUrl("https://youtube.com/@builder"));
    const [preview, start] = await Promise.all([service.metadata(target), service.metadata(target)]);
    assert.equal(preview.isLive, true);
    assert.equal(start.streamId, videoId);
    assert.equal(start.broadcasterId, channel);
    assert.equal(start.title, "bot testing");
    assert.equal(calls.filter((url) => url.includes("googleapis.com")).length, 1);
    assert.ok(calls.every((url) => !url.includes("/search?")));
    // Sweep parses the persisted concrete URL and must use the same fallback.
    clock += 11000;
    assert.equal((await service.metadata(parseYoutubeStreamUrl(target.url))).isLive, true);
    ended = true; clock += 11000;
    assert.equal((await service.metadata(parseYoutubeStreamUrl(target.url))).isLive, false);
});
test("API end/empty results remain authoritative and never accept a client marker", async () => {
    for (const body of [apiVideo(true), {items: []}]) {
        const service = createYoutubeStreamService({apiKey: "test", fetchImpl: async () => response(body)});
        assert.equal((await service.metadata({youtubeVideoId: videoId, youtubeLiveDiscovered: true})).isLive, false);
    }
});
test("unknown fallback state and credential errors are unavailable, never offline", async () => {
    const service = createYoutubeStreamService({apiKey: "test", logger: {warn() {}},
        fetchImpl: async (url) => url.includes("googleapis.com") ? quota() :
            response(player({}, {}, "LOGIN_REQUIRED"))});
    await assert.rejects(service.metadata({youtubeVideoId: videoId}), /Could not read video data/);
    const denied = createYoutubeStreamService({apiKey: "test", logger: {warn() {}},
        fetchImpl: async () => response({error: {errors: [{reason: "keyInvalid"}]}}, 403)});
    await assert.rejects(denied.metadata({youtubeVideoId: videoId}), /keyInvalid/);
});

test("blocked cloud player uses exact LIVE listing and persists channel proof through sweep", async () => {
    let clock = 100000;
    let live = true;
    const service = createYoutubeStreamService({apiKey: "test", now: () => clock, logger: {warn() {}},
        fetchImpl: async (url) => {
            if (url.includes("googleapis.com")) return quota();
            if (url.includes("/streams?")) return response(channelPage(live ? liveContents : {}));
            if (url.includes("/oembed?")) return response({author_url: "https://youtube.com/channel/" + channel});
            return response("<html>Player unavailable</html>");
        }});
    const target = await service.resolve(parseYoutubeStreamUrl("https://youtube.com/channel/" + channel));
    assert.equal(target.youtubeVideoId, videoId);
    assert.equal((await service.metadata(target)).isLive, true);
    clock += 11000;
    assert.equal((await service.metadata(parseYoutubeStreamUrl(target.url))).isLive, true);
    clock += 11000;
    live = false;
    assert.equal((await service.metadata({...parseYoutubeStreamUrl(target.url), youtubeChannelId: channel})).isLive, false);
});

test("a LIVE badge for another video or another channel cannot verify the requested stream", async () => {
    const service = createYoutubeStreamService({apiKey: "test", logger: {warn() {}},
        fetchImpl: async (url) => url.includes("googleapis.com") ? quota() :
            response(url.includes("/streams?") ? channelPage(liveContents) : "<html>Blocked</html>")});
    assert.equal((await service.metadata({youtubeVideoId: "abcdefghijk", youtubeChannelId: channel})).isLive, false);
    await assert.rejects(service.metadata({youtubeVideoId: videoId,
        youtubeChannelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw"}), /different channel/);
});
