import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {vi,test,expect} from 'vitest';
vi.mock('../../firebase/config',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),getDoc:vi.fn(async()=>({data:()=>({imageUrls:['https://test/one.png','https://test/two.png']})}))}));
import ReportModal from './ReportModal';
test('image reports require selection and forward the chosen creation image',async()=>{
 const confirm=vi.fn();render(<ReportModal targetType="creation" targetId="test" initialCategory="images" onConfirm={confirm} onCancel={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Image needs review'}});
 expect(screen.getByRole('button',{name:'Submit Report'})).toHaveAttribute('aria-disabled','true');
 fireEvent.click(await screen.findByRole('button',{name:'Select image 2'}));
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 expect(confirm).toHaveBeenLastCalledWith('Image needs review','images','https://test/two.png');
 await screen.findByRole('button',{name:'Submit Report'});
 fireEvent.click(screen.getByRole('button',{name:'Text',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Submit Report'}));
 expect(confirm).toHaveBeenLastCalledWith('Image needs review','text',undefined);
});
