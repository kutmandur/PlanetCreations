import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import ModerationIndexPanel from './ModerationIndexPanel';
const state=vi.hoisted(()=>({reads:[],stops:[],docs:[{id:'block',data:()=>({entries:{a:{key:'a',id:'creation',type:'creation',title:'Test case',reportCount:1,pendingCount:1}}})}]}));
vi.mock('../../firebase/config',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({collection:(_,path)=>({path}),query:(ref,...constraints)=>({...ref,constraints}),where:()=>null,orderBy:()=>null,limit:()=>null,startAfter:()=>null,onSnapshot:(ref,next)=>{state.reads.push(ref.path);next({docs:['moderationIndexBlocks','moderationArchiveBlocks'].includes(ref.path)?state.docs:[{id:'report',data:()=>({reason:'Private reason'})}]});return()=>state.stops.push(ref.path);},doc:()=>({})}));
vi.mock('../cards/ReportCard',()=>({default:({item})=><div>Loaded report: {item.reports[0].reason}</div>}));
vi.mock('../ui/ReportReviewControls',()=>({ModerationButton:({label,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{label}</button>}));
afterEach(()=>{cleanup();state.reads=[];state.stops=[];});
test('summary loads one index subscription and opens reports only on demand',()=>{
 render(<ModerationIndexPanel category="Creations"/>);
 expect(state.reads).toEqual(['moderationIndexBlocks']);
 expect(screen.queryByText(/Private reason/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Open case'}));
 expect(state.reads).toEqual(['moderationIndexBlocks','reports']);
 expect(screen.getByText(/Private reason/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Close case details'}));
 expect(state.stops).toContain('reports');
});
test('changing index page stops the old index subscription',()=>{
 render(<ModerationIndexPanel category="Creations"/>);
 fireEvent.click(screen.getByRole('button',{name:'Next page'}));
 expect(state.stops).toEqual(['moderationIndexBlocks']);
 expect(state.reads).toEqual(['moderationIndexBlocks','moderationIndexBlocks']);
});

test('archive uses separate blocks and delegates detail loading only after opening',()=>{
 const open=vi.fn();render(<ModerationIndexPanel category="Creations" archive onOpenCase={open}/>);
 expect(state.reads).toEqual(['moderationArchiveBlocks']);
 fireEvent.click(screen.getByRole('button',{name:'Open case'}));
 expect(open).toHaveBeenCalledWith(expect.objectContaining({key:'a'}));
 expect(state.reads).toEqual(['moderationArchiveBlocks']);
});
