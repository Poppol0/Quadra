#!/usr/bin/env python3
"""Generate COFF .syso resources (icon + asInvoker manifest) for Go Windows/amd64."""
import os,struct,sys
from pathlib import Path

MANIFEST='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="Quadra.Desktop.Installer" type="win32"/>
  <description>Quadra Desktop - installazione locale per utente</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4c9a39}"/>
    </application>
  </compatibility>
</assembly>
'''.encode('utf-8')

class DirNode:
    def __init__(self, children):
        self.children = children # [(integer id, DirNode | bytes)]
        self.offset = None
        self.entries_offset = None

def ico_resources(path):
    raw=Path(path).read_bytes(); res,kind,count=struct.unpack_from('<HHH',raw,0)
    assert res==0 and kind==1 and 0<count<=30
    icons=[]; grp=bytearray(struct.pack('<HHH',0,1,count))
    for i in range(count):
        row=raw[6+i*16:6+(i+1)*16]
        width,height,color,reserved,planes,bpp,size,offset=struct.unpack('<BBBBHHII',row)
        assert len(raw[offset:offset+size])==size
        grp += struct.pack('<BBBBHHIH',width,height,color,reserved,planes,bpp,size,i+1)
        icons.append((i+1,raw[offset:offset+size]))
    return icons,bytes(grp)

def align4(b):
    while len(b)%4:b.append(0)

def make_resource_coff(path_out,ico_path):
    icons,group=ico_resources(ico_path)
    root=DirNode([
       (3, DirNode([(i,DirNode([(0x409,data)])) for i,data in icons])),
       (14,DirNode([(1,DirNode([(0x409,group)]))])),
       (24,DirNode([(1,DirNode([(0x409,MANIFEST)]))]))
    ])
    buffer=bytearray()
    def alloc_dirs(node):
        node.offset=len(buffer)
        buffer.extend(b'\0'*(16+len(node.children)*8))
        node.entries_offset=node.offset+16
        for _,ch in node.children:
            if isinstance(ch,DirNode):
                alloc_dirs(ch)
    alloc_dirs(root)
    align4(buffer)
    leaves=[]
    def alloc_data(node):
        for _,ch in node.children:
            if isinstance(ch,DirNode): alloc_data(ch)
            else:
                assert isinstance(ch,bytes)
                dataEntry=len(buffer)
                buffer.extend(b'\0'*16)
                leaves.append((node,_,ch,dataEntry))
    alloc_data(root)
    align4(buffer)
    reloc=[]
    def fill_dirs(node):
        struct.pack_into('<IIHHHH', buffer,node.offset,0,0,0,0,0,len(node.children))
        for i,(id,ch) in enumerate(node.children):
            ent=node.entries_offset+i*8
            if isinstance(ch,DirNode):
                struct.pack_into('<II',buffer,ent,id,0x80000000|ch.offset)
                fill_dirs(ch)
            else:
                off=next(leaf[3] for leaf in leaves if leaf[0] is node and leaf[1] == id)
                struct.pack_into('<II',buffer,ent,id,off)
    fill_dirs(root)
    for parent,id,data,at in leaves:
        dataoff=len(buffer)
        buffer.extend(data)
        align4(buffer)
        struct.pack_into('<IIII',buffer,at,dataoff,len(data),0,0)
        reloc.append((at,0,0x0003))  # relocation Addr32NB to .rsrc section symbol
    # COFF file header 20, section header 40, section data, reloc 10 each, symbols (18 bytes), string table len4.
    secptr=60; relocptr=secptr+len(buffer); symptr=relocptr+10*len(reloc)
    coff=bytearray(struct.pack('<HHIIIHH',0x8664,1,0,symptr,1,0,0))
    assert len(coff)==20
    coff += struct.pack('<8sIIIIIIHHI',b'.rsrc\0\0\0',0,0,len(buffer),secptr,relocptr,0,len(reloc),0,0x40000040)
    assert len(coff)==60
    coff += buffer
    for offset,symbol,kind in reloc:coff+=struct.pack('<IIH',offset,symbol,kind)
    coff+=struct.pack('<8sIhHBB',b'.rsrc\0\0\0',0,1,0,3,0)
    coff+=struct.pack('<I',4)
    Path(path_out).write_bytes(coff)
    print('wrote',path_out,len(coff),'resources',len(icons)+2,'relocations',len(reloc))
if __name__=='__main__':
    make_resource_coff(sys.argv[1],sys.argv[2])
