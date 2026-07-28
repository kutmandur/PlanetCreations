import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const RuleEditor = ({ rules, setRules }) => {
    const [newRule, setNewRule] = useState('');
    const handleAddRule = () => {
        if (newRule.trim()) {
            setRules(prev => [...prev, { id: `rule-${Date.now()}`, text: newRule.trim() }]);
            setNewRule('');
        }
    };
    const handleRemoveRule = (index) => setRules(prev => prev.filter((_, i) => i !== index));
    const handleOnDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(rules);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setRules(items);
    };
    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Rules</label>
            <div className="p-4 border rounded-lg bg-gray-50">
                <DragDropContext onDragEnd={handleOnDragEnd}>
                    <Droppable droppableId="rules">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef}>
                                {rules.map((rule, index) => (
                                    <Draggable key={rule.id} draggableId={rule.id} index={index}>
                                        {(provided) => (
                                            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="flex items-center bg-white p-2 mb-2 rounded shadow">
                                                <Icon path={ICONS.dragHandle} className="w-5 h-5 text-gray-400 mr-3" />
                                                <p className="flex-grow text-gray-800">{rule.text}</p>
                                                <button type="button" onClick={() => handleRemoveRule(index)} className="text-red-500 hover:text-red-700 font-bold p-1">&times;</button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                <div className="flex space-x-2 mt-4">
                    <input type="text" value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="Add a new rule..." className="flex-grow p-2 border rounded-lg" />
                    <button type="button" onClick={handleAddRule} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Add</button>
                </div>
            </div>
        </div>
    );
};

export default RuleEditor;
