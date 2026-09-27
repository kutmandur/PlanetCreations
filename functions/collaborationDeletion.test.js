"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {anonymizeHistory, DELETED_CONTENT} = require("./collaborationDeletion");
test("removes personal text and media but preserves replies, event structure and idempotency", () => {
    const input = {versionNumber: 4, entries: [
        {authorId: "gone", authorUsername: "Name", content: "Email me: example@example.invalid", imageUrls: ["https://example.invalid/a"], parentId: "thread"},
        {authorId: "remaining", content: "Other member's reply", parentId: "thread"},
    ]};
    const result = anonymizeHistory(input, "gone");
    assert.equal(result.entries[0].content, DELETED_CONTENT);
    assert.equal(result.entries[0].authorUsername, "Deleted user");
    assert.deepEqual(result.entries[0].imageUrls, []);
    assert.deepEqual(result.entries[1], input.entries[1]);
    assert.equal(result.versionNumber, 4);
    assert.deepEqual(anonymizeHistory(result, "gone"), result);
});
test("scrubs published contributor snapshots and removes duplicated authored media", () => {
    const result = anonymizeHistory({imageUrls: ["own", "other"], changelog: [
        {contributorId: "gone", contributorUsername: "Name", text: "Personal", versionNumber: 3},
    ]}, "gone", new Set(["own"]));
    assert.deepEqual(result.imageUrls, ["other"]);
    assert.equal(result.changelog[0].text, DELETED_CONTENT);
    assert.equal(result.changelog[0].versionNumber, 3);
});
test("completing somebody else's todo does not delete their text", () => {
    const result = anonymizeHistory({createdBy: "remaining", completedBy: "gone", text: "Keep this task"}, "gone");
    assert.equal(result.text, "Keep this task");
    assert.equal(result.completedBy, null);
});

test('removes attributed task snapshots in another contributor history without touching their task',()=>{
 const input={userId:'other',completedTodos:[{id:'own-task',text:'my address'},{id:'other-task',text:'keep'}]};
 const result=anonymizeHistory(input,'gone',new Set(),new Set(['own-task']));
 assert.equal(result.completedTodos[0].text,DELETED_CONTENT);
 assert.equal(result.completedTodos[1].text,'keep');
});
