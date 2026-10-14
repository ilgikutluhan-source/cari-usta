import{L as W,C as b,g as F,E as G,d as B,a as K,b as L,i as z,v as J,F as R}from"./firebase-shared-3DJ-lhp3.js";const Y=(t,e)=>e.some(a=>t instanceof a);let A,x;function X(){return A||(A=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction])}function Q(){return x||(x=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])}const j=new WeakMap,v=new WeakMap,k=new WeakMap,m=new WeakMap,$=new WeakMap;function Z(t){const e=new Promise((a,n)=>{const r=()=>{t.removeEventListener("success",s),t.removeEventListener("error",i)},s=()=>{a(h(t.result)),r()},i=()=>{n(t.error),r()};t.addEventListener("success",s),t.addEventListener("error",i)});return e.then(a=>{a instanceof IDBCursor&&j.set(a,t)}).catch(()=>{}),$.set(e,t),e}function q(t){if(v.has(t))return;const e=new Promise((a,n)=>{const r=()=>{t.removeEventListener("complete",s),t.removeEventListener("error",i),t.removeEventListener("abort",i)},s=()=>{a(),r()},i=()=>{n(t.error||new DOMException("AbortError","AbortError")),r()};t.addEventListener("complete",s),t.addEventListener("error",i),t.addEventListener("abort",i)});v.set(t,e)}let E={get(t,e,a){if(t instanceof IDBTransaction){if(e==="done")return v.get(t);if(e==="objectStoreNames")return t.objectStoreNames||k.get(t);if(e==="store")return a.objectStoreNames[1]?void 0:a.objectStore(a.objectStoreNames[0])}return h(t[e])},set(t,e,a){return t[e]=a,!0},has(t,e){return t instanceof IDBTransaction&&(e==="done"||e==="store")?!0:e in t}};function ee(t){E=t(E)}function te(t){return t===IDBDatabase.prototype.transaction&&!("objectStoreNames"in IDBTransaction.prototype)?function(e,...a){const n=t.call(g(this),e,...a);return k.set(n,e.sort?e.sort():[e]),h(n)}:Q().includes(t)?function(...e){return t.apply(g(this),e),h(j.get(this))}:function(...e){return h(t.apply(g(this),e))}}function ae(t){return typeof t=="function"?te(t):(t instanceof IDBTransaction&&q(t),Y(t,X())?new Proxy(t,E):t)}function h(t){if(t instanceof IDBRequest)return Z(t);if(m.has(t))return m.get(t);const e=ae(t);return e!==t&&(m.set(t,e),$.set(e,t)),e}const g=t=>$.get(t);function ne(t,e,{blocked:a,upgrade:n,blocking:r,terminated:s}={}){const i=indexedDB.open(t,e),c=h(i);return n&&i.addEventListener("upgradeneeded",o=>{n(h(i.result),o.oldVersion,o.newVersion,h(i.transaction),o)}),a&&i.addEventListener("blocked",o=>a(o.oldVersion,o.newVersion,o)),c.then(o=>{s&&o.addEventListener("close",()=>s()),r&&o.addEventListener("versionchange",p=>r(p.oldVersion,p.newVersion,p))}).catch(()=>{}),c}const re=["get","getKey","getAll","getAllKeys","count"],se=["put","add","delete","clear"],w=new Map;function M(t,e){if(!(t instanceof IDBDatabase&&!(e in t)&&typeof e=="string"))return;if(w.get(e))return w.get(e);const a=e.replace(/FromIndex$/,""),n=e!==a,r=se.includes(a);if(!(a in(n?IDBIndex:IDBObjectStore).prototype)||!(r||re.includes(a)))return;const s=async function(i,...c){const o=this.transaction(i,r?"readwrite":"readonly");let p=o.store;return n&&(p=p.index(c.shift())),(await Promise.all([p[a](...c),r&&o.done]))[0]};return w.set(e,s),s}ee(t=>({...t,get:(e,a,n)=>M(e,a)||t.get(e,a,n),has:(e,a)=>!!M(e,a)||t.has(e,a)}));/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ie{constructor(e){this.container=e}getPlatformInfoString(){return this.container.getProviders().map(a=>{if(oe(a)){const n=a.getImmediate();return`${n.library}/${n.version}`}else return null}).filter(a=>a).join(" ")}}function oe(t){const e=t.getComponent();return(e==null?void 0:e.type)==="VERSION"}const y="@firebase/app",P="0.13.2";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const d=new W("@firebase/app"),ce="@firebase/app-compat",de="@firebase/analytics-compat",he="@firebase/analytics",fe="@firebase/app-check-compat",pe="@firebase/app-check",le="@firebase/auth",ue="@firebase/auth-compat",be="@firebase/database",me="@firebase/data-connect",ge="@firebase/database-compat",we="@firebase/functions",De="@firebase/functions-compat",_e="@firebase/installations",ve="@firebase/installations-compat",Ee="@firebase/messaging",ye="@firebase/messaging-compat",Ie="@firebase/performance",Ce="@firebase/performance-compat",Se="@firebase/remote-config",$e="@firebase/remote-config-compat",Be="@firebase/storage",Ae="@firebase/storage-compat",xe="@firebase/firestore",Me="@firebase/ai",Pe="@firebase/firestore-compat",He="firebase",Oe="11.10.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const I="[DEFAULT]",Ne={[y]:"fire-core",[ce]:"fire-core-compat",[he]:"fire-analytics",[de]:"fire-analytics-compat",[pe]:"fire-app-check",[fe]:"fire-app-check-compat",[le]:"fire-auth",[ue]:"fire-auth-compat",[be]:"fire-rtdb",[me]:"fire-data-connect",[ge]:"fire-rtdb-compat",[we]:"fire-fn",[De]:"fire-fn-compat",[_e]:"fire-iid",[ve]:"fire-iid-compat",[Ee]:"fire-fcm",[ye]:"fire-fcm-compat",[Ie]:"fire-perf",[Ce]:"fire-perf-compat",[Se]:"fire-rc",[$e]:"fire-rc-compat",[Be]:"fire-gcs",[Ae]:"fire-gcs-compat",[xe]:"fire-fst",[Pe]:"fire-fst-compat",[Me]:"fire-vertex","fire-js":"fire-js",[He]:"fire-js-all"};/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const l=new Map,Te=new Map,C=new Map;function H(t,e){try{t.container.addComponent(e)}catch(a){d.debug(`Component ${e.name} failed to register with FirebaseApp ${t.name}`,a)}}function S(t){const e=t.name;if(C.has(e))return d.debug(`There were multiple attempts to register component ${e}.`),!1;C.set(e,t);for(const a of l.values())H(a,t);for(const a of Te.values())H(a,t);return!0}function Qe(t,e){const a=t.container.getProvider("heartbeat").getImmediate({optional:!0});return a&&a.triggerHeartbeat(),t.container.getProvider(e)}function Ze(t){return t==null?!1:t.settings!==void 0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Fe={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":"Firebase Server App has been deleted","no-options":"Need to provide options, when not being deployed to hosting via source.","invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":"First argument to `onLog` must be null or a function.","idb-open":"Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.","idb-get":"Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.","idb-set":"Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.","idb-delete":"Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.","finalization-registry-not-supported":"FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.","invalid-server-app-environment":"FirebaseServerApp is not for use in browser environments."},f=new G("app","Firebase",Fe);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Le{constructor(e,a,n){this._isDeleted=!1,this._options=Object.assign({},e),this._config=Object.assign({},a),this._name=a.name,this._automaticDataCollectionEnabled=a.automaticDataCollectionEnabled,this._container=n,this.container.addComponent(new b("app",()=>this,"PUBLIC"))}get automaticDataCollectionEnabled(){return this.checkDestroyed(),this._automaticDataCollectionEnabled}set automaticDataCollectionEnabled(e){this.checkDestroyed(),this._automaticDataCollectionEnabled=e}get name(){return this.checkDestroyed(),this._name}get options(){return this.checkDestroyed(),this._options}get config(){return this.checkDestroyed(),this._config}get container(){return this._container}get isDeleted(){return this._isDeleted}set isDeleted(e){this._isDeleted=e}checkDestroyed(){if(this.isDeleted)throw f.create("app-deleted",{appName:this._name})}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const qe=Oe;function Re(t,e={}){let a=t;typeof e!="object"&&(e={name:e});const n=Object.assign({name:I,automaticDataCollectionEnabled:!0},e),r=n.name;if(typeof r!="string"||!r)throw f.create("bad-app-name",{appName:String(r)});if(a||(a=F()),!a)throw f.create("no-options");const s=l.get(r);if(s){if(B(a,s.options)&&B(n,s.config))return s;throw f.create("duplicate-app",{appName:r})}const i=new K(r);for(const o of C.values())i.addComponent(o);const c=new Le(a,n,i);return l.set(r,c),c}function et(t=I){const e=l.get(t);if(!e&&t===I&&F())return Re();if(!e)throw f.create("no-app",{appName:t});return e}function tt(){return Array.from(l.values())}function D(t,e,a){var n;let r=(n=Ne[t])!==null&&n!==void 0?n:t;a&&(r+=`-${a}`);const s=r.match(/\s|\//),i=e.match(/\s|\//);if(s||i){const c=[`Unable to register library "${r}" with version "${e}":`];s&&c.push(`library name "${r}" contains illegal characters (whitespace or "/")`),s&&i&&c.push("and"),i&&c.push(`version name "${e}" contains illegal characters (whitespace or "/")`),d.warn(c.join(" "));return}S(new b(`${r}-version`,()=>({library:r,version:e}),"VERSION"))}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const je="firebase-heartbeat-database",ke=1,u="firebase-heartbeat-store";let _=null;function U(){return _||(_=ne(je,ke,{upgrade:(t,e)=>{switch(e){case 0:try{t.createObjectStore(u)}catch(a){console.warn(a)}}}}).catch(t=>{throw f.create("idb-open",{originalErrorMessage:t.message})})),_}async function Ue(t){try{const a=(await U()).transaction(u),n=await a.objectStore(u).get(V(t));return await a.done,n}catch(e){if(e instanceof R)d.warn(e.message);else{const a=f.create("idb-get",{originalErrorMessage:e==null?void 0:e.message});d.warn(a.message)}}}async function O(t,e){try{const n=(await U()).transaction(u,"readwrite");await n.objectStore(u).put(e,V(t)),await n.done}catch(a){if(a instanceof R)d.warn(a.message);else{const n=f.create("idb-set",{originalErrorMessage:a==null?void 0:a.message});d.warn(n.message)}}}function V(t){return`${t.name}!${t.options.appId}`}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ve=1024,We=30;class Ge{constructor(e){this.container=e,this._heartbeatsCache=null;const a=this.container.getProvider("app").getImmediate();this._storage=new ze(a),this._heartbeatsCachePromise=this._storage.read().then(n=>(this._heartbeatsCache=n,n))}async triggerHeartbeat(){var e,a;try{const r=this.container.getProvider("platform-logger").getImmediate().getPlatformInfoString(),s=N();if(((e=this._heartbeatsCache)===null||e===void 0?void 0:e.heartbeats)==null&&(this._heartbeatsCache=await this._heartbeatsCachePromise,((a=this._heartbeatsCache)===null||a===void 0?void 0:a.heartbeats)==null)||this._heartbeatsCache.lastSentHeartbeatDate===s||this._heartbeatsCache.heartbeats.some(i=>i.date===s))return;if(this._heartbeatsCache.heartbeats.push({date:s,agent:r}),this._heartbeatsCache.heartbeats.length>We){const i=Je(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(i,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(n){d.warn(n)}}async getHeartbeatsHeader(){var e;try{if(this._heartbeatsCache===null&&await this._heartbeatsCachePromise,((e=this._heartbeatsCache)===null||e===void 0?void 0:e.heartbeats)==null||this._heartbeatsCache.heartbeats.length===0)return"";const a=N(),{heartbeatsToSend:n,unsentEntries:r}=Ke(this._heartbeatsCache.heartbeats),s=L(JSON.stringify({version:2,heartbeats:n}));return this._heartbeatsCache.lastSentHeartbeatDate=a,r.length>0?(this._heartbeatsCache.heartbeats=r,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),s}catch(a){return d.warn(a),""}}}function N(){return new Date().toISOString().substring(0,10)}function Ke(t,e=Ve){const a=[];let n=t.slice();for(const r of t){const s=a.find(i=>i.agent===r.agent);if(s){if(s.dates.push(r.date),T(a)>e){s.dates.pop();break}}else if(a.push({agent:r.agent,dates:[r.date]}),T(a)>e){a.pop();break}n=n.slice(1)}return{heartbeatsToSend:a,unsentEntries:n}}class ze{constructor(e){this.app=e,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return z()?J().then(()=>!0).catch(()=>!1):!1}async read(){if(await this._canUseIndexedDBPromise){const a=await Ue(this.app);return a!=null&&a.heartbeats?a:{heartbeats:[]}}else return{heartbeats:[]}}async overwrite(e){var a;if(await this._canUseIndexedDBPromise){const r=await this.read();return O(this.app,{lastSentHeartbeatDate:(a=e.lastSentHeartbeatDate)!==null&&a!==void 0?a:r.lastSentHeartbeatDate,heartbeats:e.heartbeats})}else return}async add(e){var a;if(await this._canUseIndexedDBPromise){const r=await this.read();return O(this.app,{lastSentHeartbeatDate:(a=e.lastSentHeartbeatDate)!==null&&a!==void 0?a:r.lastSentHeartbeatDate,heartbeats:[...r.heartbeats,...e.heartbeats]})}else return}}function T(t){return L(JSON.stringify({version:2,heartbeats:t})).length}function Je(t){if(t.length===0)return-1;let e=0,a=t[0].date;for(let n=1;n<t.length;n++)t[n].date<a&&(a=t[n].date,e=n);return e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ye(t){S(new b("platform-logger",e=>new ie(e),"PRIVATE")),S(new b("heartbeat",e=>new Ge(e),"PRIVATE")),D(y,P,t),D(y,P,"esm2017"),D("fire-js","")}Ye("");export{qe as S,S as _,Ze as a,Qe as b,tt as c,et as g,Re as i,D as r};
