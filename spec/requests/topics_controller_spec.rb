# frozen_string_literal: true

require 'rails_helper'

describe TopicsController do
  let(:topic) { Fabricate(:encrypt_topic) }
  let(:user) { Fabricate(:user) }
  let(:group) { Fabricate(:group) }

  before do
    sign_in(Fabricate(:admin))
  end

  context '#update' do
    it 'updates encrypted title' do
      put "/t/#{topic.slug}/#{topic.id}.json", params: { encrypted_title: 'new encrypted title' }

      expect(response.status).to eq(200)
      expect(topic.reload.custom_fields[DiscourseEncrypt::TITLE_CUSTOM_FIELD]).to eq('new encrypted title')
    end
  end

  context '#invite' do
    it 'saves user key' do
      post "/t/#{topic.id}/invite.json", params: { user: user.username, key: 'key of user' }

      expect(response.status).to eq(200)
      expect(TopicAllowedUser.where(user_id: user.id, topic_id: topic.id).exists?).to eq(true)
      expect(PluginStoreRow.find_by(key: "key_#{topic.id}_#{user.id}").value).to eq('key of user')
    end

    it 'returns an error with no key' do
      post "/t/#{topic.id}/invite.json", params: { user: user.username }

      expect(response.status).to eq(422)
      expect(TopicAllowedUser.where(user_id: user.id, topic_id: topic.id).exists?).to eq(false)
      expect(PluginStoreRow.where(key: "key_#{topic.id}_#{user.id}").exists?).to eq(false)
    end
  end

  context '#invite_group' do
    it 'returns an error with no key' do
      post "/t/#{topic.id}/invite-group.json", params: { group: group.name }

      expect(response.status).to eq(422)
      expect(TopicAllowedGroup.where(group_id: group.id, topic_id: topic.id).exists?).to eq(false)
    end
  end
end
