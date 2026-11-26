/* Quadra: predisposizione Service Worker per notifiche web, senza cache di dati bancari. */
'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Le richieste non sono intercettate: archivio e API rimangono serviti dal PC.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch(_){data={};}
 const title=typeof data.title==='string'&&data.title.length<100?data.title:'Quadra · Scadenze';
 const body=typeof data.body==='string'&&data.body.length<240?data.body:'Hai una scadenza da verificare. Apri Quadra.';
 event.waitUntil(self.registration.showNotification(title,{body,icon:'/icon-192.png',badge:'/icon-192.png',tag:'quadra-push',data:{url:'/#recurring'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
   const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   for(const client of all){if(new URL(client.url).origin===self.location.origin){await client.focus();await client.navigate('/#recurring');return;}}
   await self.clients.openWindow('/#recurring');
 })());
});
