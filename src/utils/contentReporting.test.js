import { getReportableContent } from './contentReporting';

test('maps supported UGC detail routes to safe report targets', () => {
    expect(getReportableContent('/event/summer-2026')).toEqual({
        markerId: 'event%3Asummer-2026',
        targetId: 'summer-2026',
        targetPath: '/event/summer-2026',
        targetTitle: 'Event content',
        targetType: 'event',
    });
    expect(getReportableContent('/collaboration/create')).toBeNull();
    expect(getReportableContent('/privacy')).toBeNull();
});

test('canonical and legacy community routes resolve the same slug',()=>{expect(getReportableContent('/park-builders')).toEqual(getReportableContent('/community/park-builders'));expect(getReportableContent('/settings')).toBeNull();});
