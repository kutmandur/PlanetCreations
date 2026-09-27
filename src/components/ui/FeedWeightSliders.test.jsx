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
