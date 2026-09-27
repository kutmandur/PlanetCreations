import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {vi,test,expect} from 'vitest';
vi.mock('../../firebase/config',()=>({db:{}}));
import UserBlockButton from './UserBlockButton';
import {BlockingContext} from '../../contexts/BlockingContext';
import ReportModal from './ReportModal';
test('blocking exposes state and waits for the server',async()=>{
 const setBlocked=vi.fn().mockResolvedValue(undefined);
 const {rerender}=render(<BlockingContext.Provider value={{userId:'me',isBlocked:()=>false,setBlocked}}><UserBlockButton targetUserId="other"/></BlockingContext.Provider>);
 fireEvent.click(screen.getByRole('button',{name:'Block user'}));
 await waitFor(()=>expect(setBlocked).toHaveBeenCalledWith('other',true));
 rerender(<BlockingContext.Provider value={{userId:'me',isBlocked:()=>true,setBlocked}}><UserBlockButton targetUserId="other"/></BlockingContext.Provider>);
 expect(screen.getByRole('button',{name:'Unblock user'})).toBeInTheDocument();
});
test('reports accept quoted policy violations as evidence',()=>{
 const confirm=vi.fn();render(<ReportModal targetType="comment" blacklist={['forbidden']} onConfirm={confirm} onCancel={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'This message says forbidden'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 expect(confirm).toHaveBeenCalledWith('This message says forbidden','other',undefined);
});
test('report category selector sends the selected category',()=>{
 const confirm=vi.fn();render(<ReportModal targetType="creation" initialCategory="images" onConfirm={confirm} onCancel={()=>{}}/>);
 expect(screen.getByRole('button',{name:'Images'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Text',exact:true}));
 expect(screen.getByRole('button',{name:'Text',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'Images'})).toHaveAttribute('aria-pressed','false');
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Check description'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 expect(confirm).toHaveBeenCalledWith('Check description','text',undefined);
});
test('failed reports keep the reason and allow retrying without duplicate submissions',async()=>{
 const confirm=vi.fn().mockRejectedValueOnce(new Error('Temporary connection problem')).mockResolvedValueOnce({});
 render(<ReportModal targetType="comment" onConfirm={confirm} onCancel={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Keep this explanation'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 await screen.findByText('Temporary connection problem');
 expect(screen.getByLabelText('Reason')).toHaveValue('Keep this explanation');
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));
});
test('a selected video remains attached when reporting it under Other',async()=>{
 const confirm=vi.fn().mockResolvedValue({});
 render(<ReportModal targetType="creation" targetId="park" initialCategory="other" initialMediaType="video" initialMediaUrl="https://test/video.mp4" onConfirm={confirm} onCancel={()=>{}}/>);
 expect(screen.getByText('This report refers to the selected video.')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Review the video'}});
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 await waitFor(()=>expect(confirm).toHaveBeenCalledWith('Review the video','other','https://test/video.mp4'));
});
