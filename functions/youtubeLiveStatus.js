"use strict";

function isYoutubeVideoLive(video) {
    const snippetStatus = String(video?.snippet?.liveBroadcastContent || "").toLowerCase();
    const streamingDetails = video?.liveStreamingDetails || {};

    // YouTube can keep the snippet status cached as "live" briefly after the
    // watch page has already switched to the completed broadcast/VOD. The end
    // timestamp is the authoritative terminal signal in that transition.
    if (streamingDetails.actualEndTime) return false;

    return snippetStatus === "live";
}

module.exports = {isYoutubeVideoLive};
