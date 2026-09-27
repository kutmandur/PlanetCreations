import React from 'react';
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import ReviewHistoryManager from './ReviewHistoryManager';
import {onSnapshot} from 'firebase/firestore';
const fixture=vi.hoisted(()=>({call:vi.fn().mockResolvedValue({}),review:{id:'case-1',targetType:'creation',targetId:'park',status:'dismiss',reason:'Initial reason',reviewedBy:'mod',revision:3,history:[{action:'dismiss',reason:'Initial reason',actorUid:'mod'}]}}));
vi.mock('../../firebase/config',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn(),query:vi.fn(),orderBy:vi.fn(),limit:vi.fn(),doc:vi.fn(),onSnapshot:vi.fn((ref,next)=>{next({docs:[{id:fixture.review.id,data:()=>fixture.review}]});return ()=>{};}),getDoc:vi.fn(async()=>({exists:()=>true,data:()=>({username:'TestModerator'})}))}));
vi.mock('./ModerationIndexPanel',()=>({default:()=>null}));
vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:()=>fixture.call}));
vi.mock('../ui/ReportReviewControls',()=>({default:()=>null,ModerationButton:({label,onClick})=><button onClick={onClick}>{label}</button>}));
afterEach(()=>{cleanup();fixture.call.mockClear();});
test('shows moderator attribution and corrects a reason using its original revision',async()=>{
 render(<ReviewHistoryManager/>);fireEvent.click(screen.getByRole('button',{name:'All review history'}));expect(await screen.findByText('Reviewed by: TestModerator')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Edit reason'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Corrected review reason'}),{target:{value:'Corrected reason'}});
 fireEvent.click(screen.getByRole('button',{name:'Save review change'}));
 await waitFor(()=>expect(fixture.call).toHaveBeenCalledWith({caseId:'case-1',reason:'Corrected reason',expectedRevision:3}));
});
test('reopening explicitly records a new reason without changing content in the browser',async()=>{
 render(<ReviewHistoryManager/>);fireEvent.click(screen.getByRole('button',{name:'All review history'}));fireEvent.click(screen.getByRole('button',{name:'Reopen review'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Reason for reopening'}),{target:{value:'Further evidence'}});
 fireEvent.click(screen.getByRole('button',{name:'Save review change'}));
 await waitFor(()=>expect(fixture.call).toHaveBeenCalledWith({reportId:'case-1',action:'reopen',reason:'Further evidence',expectedRevision:3}));
});

test('archive landing does not load review records before opening history',()=>{
 onSnapshot.mockClear();render(<ReviewHistoryManager/>);
 expect(onSnapshot).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'All review history'}));
 expect(onSnapshot).toHaveBeenCalledTimes(1);
});
