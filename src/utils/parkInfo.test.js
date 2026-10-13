import {getParkInfo, sanitizeNumericInfo, PARK_INFO_FIELDS} from './parkInfo';
import {sanitizeParkRidePresentation} from './parkRidePresentation';

test('displays only finite creator values and preserves explicit clearing and zero', () => {
    const presentation = sanitizeParkRidePresentation({parkInfo: {placementCost: null, runningCost: 0, guestCount: 'free', poolCount: Infinity}});
    expect(getParkInfo({blueprint: {placementCost: 50}}, presentation)).toEqual({placementCost: null, runningCost: 0});
    expect(sanitizeNumericInfo({placementCost: {}, guestCount: ['1'], poolCount: NaN}, PARK_INFO_FIELDS)).toEqual({});
});
