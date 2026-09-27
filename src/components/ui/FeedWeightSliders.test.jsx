import React, {useState} from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import FeedWeightSliders from './FeedWeightSliders';
import {DEFAULT_WEIGHTS} from '../../utils/feedRanking';
test('slider positions and displayed percentages update together to 100 percent', () => {
    function Mixer() {const [weights, setWeights] = useState(DEFAULT_WEIGHTS);return <FeedWeightSliders weights={weights} onChange={setWeights}/>;}
    render(<Mixer/>);
    fireEvent.change(screen.getByRole('slider', {name:'Live creations'}), {target:{value:'55'}});
    const sliders = screen.getAllByRole('slider');
    expect(sliders.reduce((total, slider) => total + Number(slider.value), 0)).toBe(100);
    expect(screen.getByRole('slider', {name:'Live creations'}).value).toBe('55');
    for (const slider of sliders) expect(slider).toHaveAttribute('aria-valuetext', `${slider.value}%`);
});

test('restores the previous ratios after moving a category to 100 percent', () => {
    const initial = {live:10, recency:37, popularity:23, activity:17, affinity:12, discovery:1};
    let latest;
    function Mixer() {
        const [weights, setWeights] = useState(initial);
        latest = weights;
        return <FeedWeightSliders weights={weights} onChange={setWeights}/>;
    }
    render(<Mixer/>);
    const live = screen.getByRole('slider', {name:'Live creations'});
    fireEvent.change(live, {target:{value:'100'}});
    fireEvent.change(live, {target:{value:'40'}});
    for (const key of Object.keys(initial).filter(key => key !== 'live')) {
        expect(latest[key] / latest.discovery).toBeCloseTo(initial[key], 10);
    }
    expect(latest.live).toBe(40);
});
