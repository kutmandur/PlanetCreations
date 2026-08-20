"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    fetchYoutubeChannelFeed,
    parseYoutubeChannelPage,
    parseYoutubeRss,
} = require("./youtubeFeed");

const channelPageHtml = `
    <script>
        var ytInitialData = {
            "metadata": {"channelMetadataRenderer": {"title": "Planet Builders"}},
            "contents": {
                "items": [
                    {"richItemRenderer": {"content": {"videoRenderer": {
                        "videoId": "abcdefghijk",
                        "title": {"runs": [{"text": "First {build}"}]},
                        "publishedTimeText": {"simpleText": "2 days ago"}
                    }}}},
                    {"gridVideoRenderer": {
                        "videoId": "lmnopqrstuv",
                        "title": {"simpleText": "Second build"}
                    }},
                    {"videoRenderer": {
                        "videoId": "abcdefghijk",
                        "title": {"simpleText": "Duplicate"}
                    }},
                    {"lockupViewModel": {
                        "contentId": "zyxwvutsrqp",
                        "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
                        "metadata": {"lockupMetadataViewModel": {
                            "title": {"content": "Current YouTube layout"},
                            "metadata": {"contentMetadataViewModel": {"metadataRows": [{
                                "metadataParts": [
                                    {"text": {"content": "1K views"}},
                                    {"text": {"content": "3 days ago", "accessibilityLabel": "3 days ago"}}
                                ]
                            }]}}
                        }}
                    }}
                ]
            }
        };
    </script>`;

test("parses YouTube RSS video data and XML entities", () => {
    const result = parseYoutubeRss(`
        <feed>
            <title>Planet &amp; Builders</title>
            <entry>
                <yt:videoId>abcdefghijk</yt:videoId>
                <title>Coaster &quot;One&quot;</title>
                <published>2026-08-19T12:00:00+00:00</published>
            </entry>
        </feed>`);

    assert.equal(result.channelTitle, "Planet & Builders");
    assert.deepEqual(result.videos, [{
        id: "abcdefghijk",
        title: 'Coaster "One"',
        published: "2026-08-19T12:00:00+00:00",
    }]);
});

test("parses and deduplicates videos from a YouTube channel page", () => {
    const result = parseYoutubeChannelPage(channelPageHtml);

    assert.equal(result.channelTitle, "Planet Builders");
    assert.deepEqual(result.videos, [
        {
            id: "abcdefghijk",
            title: "First {build}",
            published: null,
            publishedText: "2 days ago",
        },
        {
            id: "lmnopqrstuv",
            title: "Second build",
            published: null,
            publishedText: null,
        },
        {
            id: "zyxwvutsrqp",
            title: "Current YouTube layout",
            published: null,
            publishedText: "3 days ago",
        },
    ]);
});

test("falls back to the channel page when YouTube RSS returns 404", async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
        requestedUrls.push(url);
        if (url.includes("feeds/videos.xml")) {
            return {ok: false, status: 404};
        }
        return {
            ok: true,
            status: 200,
            text: async () => channelPageHtml,
        };
    };

    const result = await fetchYoutubeChannelFeed("UC_x5XG1OV2P6uZZ5FSM9Ttw", fetchImpl);

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /\/channel\/UC_x5XG1OV2P6uZZ5FSM9Ttw\/videos/);
    assert.equal(result.videos.length, 3);
    assert.equal(result.videos[0].id, "abcdefghijk");
});
