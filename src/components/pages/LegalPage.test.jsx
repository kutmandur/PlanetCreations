import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import LegalPage from './LegalPage';
const state=vi.hoisted(()=>({mode:'loading'}));
vi.mock('../../firebase/config',()=>({db:{}}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),setDoc:vi.fn(),onSnapshot:(_,success,failure)=>{
 if(state.mode==='missing')success({exists:()=>false});
 if(state.mode==='error')failure(new Error('Offline'));
 return ()=>{};
}}));
afterEach(cleanup);
for(const mode of ['loading','missing','error'])test(`contact remains available when legal page is ${mode}`,()=>{
 state.mode=mode;render(<LegalPage docId="impressum" title="Legal Notice"/>);
 expect(screen.getByRole('link',{name:'info@planetcreations.net'})).toHaveAttribute('href','mailto:info@planetcreations.net');
});
