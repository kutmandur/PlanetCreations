import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CustomFieldsEditor = ({ fields, setCustomFields }) => {
    const addField = () => {
        if (fields.length < 5) {
            setCustomFields(prev => [...prev, { id: `field-${Date.now()}`, label: '', required: true }]);
        }
    };
    const updateField = (index, key, value) => {
        const newFields = [...fields];
        newFields[index][key] = value;
        setCustomFields(newFields);
    };
    const removeField = (index) => setCustomFields(prev => prev.filter((_, i) => i !== index));
    const handleOnDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(fields);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setCustomFields(items);
    };
    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Custom Entry Fields</label>
            <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                <DragDropContext onDragEnd={handleOnDragEnd}>
                    <Droppable droppableId="customFields">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef}>
                                {fields.map((field, index) => (
                                    <Draggable key={field.id} draggableId={field.id} index={index}>
                                        {(provided) => (
                                            <div ref={provided.innerRef} {...provided.draggableProps} className="flex items-center space-x-3 bg-white p-2 rounded shadow">
                                                <div {...provided.dragHandleProps}><Icon path={ICONS.dragHandle} className="w-5 h-5 text-gray-400 cursor-grab" /></div>
                                                <input type="text" value={field.label} onChange={(e) => updateField(index, 'label', e.target.value)} placeholder={`Custom Field #${index + 1}`} className="flex-grow p-2 border rounded-lg" />
                                                <div className="flex items-center space-x-2">
                                                    <span className={`text-xs font-semibold ${field.required ? 'text-green-600' : 'text-gray-500'}`}>{field.required ? 'Required' : 'Optional'}</span>
                                                    <div className="relative w-12 h-6 flex items-center rounded-full cursor-pointer p-1" onClick={() => updateField(index, 'required', !field.required)} style={{ backgroundColor: field.required ? '#34D399' : '#D1D5DB' }}>
                                                        <div className={`absolute bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${field.required ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                                    </div>
                                                </div>
                                                <button type="button" onClick={() => removeField(index)} className="text-red-500 hover:text-red-700 font-bold p-1">&times;</button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                {fields.length < 5 && (<button type="button" onClick={addField} className="text-sm text-blue-500 hover:underline mt-3">+ Add Custom Field</button>)}
            </div>
        </div>
    );
};

export default CustomFieldsEditor;
