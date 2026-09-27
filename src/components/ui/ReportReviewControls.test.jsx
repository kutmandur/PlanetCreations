import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import ReportReviewControls from './ReportReviewControls';
const state=vi.hoisted(()=>({review:null,call:vi.fn().mockResolvedValue({})}));
vi.mock('../../firebase/config',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),onSnapshot:vi.fn((ref,next)=>{next({data:()=>state.review});return ()=>{};})}));
vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:()=>state.call}));
afterEach(()=>{cleanup();state.review=null;state.call.mockClear();});
const reports=[{id:'r1',reason:'Test report',status:'open'}];
test('resolve requires a reason and uses the audited backend instead of deleting the report',async()=>{
 render(<ReportReviewControls reports={reports}/>);
 fireEvent.click(screen.getByRole('button',{name:'Resolve'}));expect(state.call).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'Review reason'}),{target:{value:'No violation'}});
 fireEvent.click(screen.getByRole('button',{name:'Resolve'}));
 await waitFor(()=>expect(state.call).toHaveBeenCalledWith({reportId:'r1',action:'dismiss',reason:'No violation'}));
});
test('withheld content offers restore instead of conflicting resolve and withhold actions',()=>{
 state.review={status:'reviewing',original:{title:'Original'}};
 render(<ReportReviewControls reports={reports}/>);
 expect(screen.getByRole('button',{name:'Restore'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Resolve'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Withhold'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Start review'})).not.toBeInTheDocument();
});
test('closed reports keep history and independent sanctions without duplicate review actions',()=>{
 state.review={status:'restore',history:[{action:'restore',reason:'Verified'}]};
 render(<ReportReviewControls reports={reports}><button>Strike</button></ReportReviewControls>);
 expect(screen.getByRole('button',{name:'Strike'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Resolve'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Withhold'})).not.toBeInTheDocument();
});
