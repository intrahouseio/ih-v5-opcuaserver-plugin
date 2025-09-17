# Структуры данных 

## Поступающие с сервера

### Фильтры для устройств
Настраивается в таблице Расширений плагина.      
Фильтры определяют подмножества устройств для OPC Server-а

#### Получение с сервера всех фильтров
```js
const extraChannels = await plugin.extra.get();
```

#### Подписка на изменение элементов фильтра
По событию изменения приходит массив, содержащий изменения фильтров:
```js
plugin.onChange('extra', async recs => {
  // recs = [{op:'add|update|delete', filter:'tag|location|device', ....}] 
});
```


### Данные устройств

#### Получение с сервера устройств с заданным фильтром
Используется для построения узлов OPC 
```js
const devs = await plugin.get('devices', <oneFilter>, { alerts: !!params.ae, dbsave: !!params.hda });
```

#### Подписка на изменение подмножеств устройств, входящих в фильтры extra

По событию изменения приходит массив.
Элемент массива содержит актуальные данные одного устройства (как при получении по запросу plugin.devices.get), а также массивы фильтров exclude и include.

- exclude - содержит ВСЕ фильтры, которые включали устройство до изменения
   Если устройство новое (или не попадало ни в один фильтр) - exclude будет пуст 

- include - содержит ВСЕ фильтры, в которые попадает устройство после изменения
  Если устройство удалено (или исключено из фильтров, например, уделена метка, перемещено в другую папку)  - include будет пуст 


```js
plugin.onExtraMatch('devices', data => {
  // data =[{include:[], exclude:[], did, dn, ....props:[],...}]
```

<pre>
[{
    _id: 'd0009',
    name: 'Датчик дыма 2 (copy)',
    dn: 'DP_005',
    type: 't011',
    parent: 'dg004',
    tags: '##',
    location: '/place/dg002/dg003/dg004/',
    props: {
      state: {
        name: 'Состояние',
        op: 'rw',
        vtype: 'B',
        min: null,
        max: null,
        mu: ''
      },
      blk: {
        name: 'Блокировка',
        op: 'par',
        vtype: 'B',
        min: null,
        max: null,
        mu: ''
      }
    },

 include: [
      {
        filter: 'location',
        locationStr: '/place/dg002'
      }
    ]
}]
</pre>


#### Подписка на получение значений свойств устройств
Параметр {extra:1} указывает серверу, что нужно отправлять значения всех устройств (всех свойств), входящих в фильтры.  

Список устройств, для которых нужно получать значения, на сервер передавать не нужно! 

```js
plugin.onSub('devices', {extra:1}, data => {

});
```
> Эта подписка делается один раз!  
> При изменении фильтров переподписка на получение значений не требуется, сервер будет отслеживать изменение фильтров на своей стороне. 



## Внутренние структуры для обмена данными с OPC 

## Структура для хранения значений свойств

filter.devices - объект содержит элементы для каждого свойства, ключ did.prop

<pre>
filter.devices[d003.value] = {value, ts, chstatus}
</pre>

При получении данных с сервера (onSub) плагин пишет в value, ts, chstatus элемента 


## Структура для хранения узлов дерева 

Узлы создаются при старте плагина 

Узлы удаляются и/или добавляются
- при изменении фильтров
- при добавлении/удалении устройств
- при изменении свойств устройств, приводящих к изменению в структуре дереве, включая наименования (tag, location, dn, name)
- при изменении набора свойств устройства (изменение в типе устройств, изменение типа для экземпляра)


#### filter.folders - хранит ссылки на создаваемые узлы: папки и устройства

Ссылки на узлы устройств хранятся в объектах **devNodes**     
Структура используется для перестроения дерева


*Содержимое объектов UAObjectImpl сокращено*
<pre>
filter.folders = {
  // В Devices только узлы устройств
  Devices: { devNodes: {
     d0004: UAObjectImpl {
       ...
      }
  },

  // Для каждого Tag - папка + узлы устройств
  'Климат': {
    folderNode: UAObjectImpl {
      nodeClass: 1,
      nodeId: NodeId { identifierType: 2, value: 'Климат', namespace: 1 },
      browseName: QualifiedName { namespaceIndex: 1, name: 'Климат' },
      FAN_001: [Getter],
    },

    devNodes: {
      d0004: UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Климат|FAN_001',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'FAN_001' },
        'state (FAN_001) ': [Getter],
        'auto (FAN_001) ': [Getter],
        'on() (FAN_001)': [Getter],
        'off() (FAN_001)': [Getter],
        'toggle() (FAN_001)': [Getter],
      }
    }
  },

  // Для каждого Location 
  // folderNode - корневая папка folderNode 
  // subfolderNodes - все подузлы
  // devNodes - все узлы устройств этого Location (без учета вложенности)
 
  dg002: {
    folderNode: UAObjectImpl {
      nodeClass: 1,
      nodeId: NodeId {
        identifierType: 2,
        value: 'Шкаф 1(dg002)',
        namespace: 1
      },
      browseName: QualifiedName { namespaceIndex: 1, name: 'Шкаф 1' },
      'Узел 1': [Getter],
      [Symbol(kCapture)]: false
    },

   subfolderNodes: {
      'dg002/dg003': UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'Узел 1' },
        DT_001: [Getter],
        DT_002: [Getter],
        'Рейка 1': [Getter],
        [Symbol(kCapture)]: false
      },
      'dg002/dg003/dg004': UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)/Рейка 1(dg004)',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'Рейка 1' },
        DP_001: [Getter],
        DP_002: [Getter]
      }
    },
  
 devNodes: {
      d0002: UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)|DT_001',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'DT_001' },
        'value (DT_001) ': [Getter],
        'setpoint (DT_001) ': [Getter],
      },
      d0003: UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)|DT_002',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'DT_002' },
        'value (DT_002) ': [Getter],
        'setpoint (DT_002) ': [Getter],
      },
      d0005: UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)/Рейка 1(dg004)|DP_001',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'DP_001' },
        'state (DP_001) ': [Getter],
        'blk (DP_001) ': [Getter]
      },
      d0006: UAObjectImpl {
        nodeClass: 1,
        nodeId: NodeId {
          identifierType: 2,
          value: 'Шкаф 1(dg002)/Узел 1(dg003)/Рейка 1(dg004)|DP_002',
          namespace: 1
        },
        browseName: QualifiedName { namespaceIndex: 1, name: 'DP_002' },
        'state (DP_002) ': [Getter],
        'blk (DP_002) ': [Getter],
      }
    }
  }
}
</pre> 


